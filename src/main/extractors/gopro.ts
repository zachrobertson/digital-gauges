import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FFMPEG_BIN } from '../ffmpeg-binaries';
import { CameraExtractor } from './base';
import { ffprobe, FfprobeResult, pickDataStreams } from './ffprobe';
import type { TelemetryTrack } from '../../shared/types';
import { emptyTrack, finalizeTrack, pushFrame } from './util';

const GPMF_STREAM_CHUNK_BYTES = 4 * 1024 * 1024;

interface GpmfExtractResult {
  rawData: Buffer;
  timing: {
    frameDuration?: number;
    videoDuration?: number;
    start?: Date;
    samples?: Array<{ cts: number; duration: number }>;
  };
}

interface GoproTelemetryStream {
  samples?: Array<{
    cts?: number;
    date?: string | number | Date;
    value?: unknown;
  }>;
  name?: string;
  units?: string;
}

interface GoproTelemetryDevice {
  streams: Record<string, GoproTelemetryStream>;
  data?: { CameraType?: string; FirmwareVersion?: string };
}

interface GoproTelemetryResult {
  [deviceId: string]: GoproTelemetryDevice;
}

/**
 * GoPro extractor — pure Node.js, no Python subprocess.
 *
 *   gpmf-extract:   reads the gpmd track out of the MP4 container
 *   gopro-telemetry: decodes the KLV GPMF stream into a JSON tree
 *
 * GoPro hardware notes:
 *   - Hero5-Hero11, Hero13+: GPS + IMU + temp
 *   - Hero12: IMU only, NO GPS (we surface a warning)
 */
export class GoProExtractor extends CameraExtractor {
  readonly id = 'gopro';
  readonly label = 'GoPro';
  readonly requiresPython = false;

  canHandle(probe: FfprobeResult | null): boolean {
    if (!probe) return false;
    const make = probe.format?.tags?.['com.apple.quicktime.make']
      ?? probe.format?.tags?.['make'];
    if (make && /gopro/i.test(make)) return true;

    return pickDataStreams(probe).some((s) => {
      if (s.codec_tag_string === 'gpmd') return true;
      if (s.handler_name && /gopro met/i.test(s.handler_name)) return true;
      return false;
    });
  }

  async extract(filePath: string): Promise<TelemetryTrack> {
    const gpmfExtractMod = await import('gpmf-extract');
    const goproTelemetryMod = await import('gopro-telemetry');
    const gpmfExtract = (gpmfExtractMod as unknown as { default?: Function }).default
      ?? (gpmfExtractMod as unknown as Function);
    const goproTelemetry = (goproTelemetryMod as unknown as { default?: Function }).default
      ?? (goproTelemetryMod as unknown as Function);

    // Prefer ffmpeg demux of the tiny gpmd track — avoids loading the full
    // video into memory (mp4box + gpmf-extract can exhaust RAM on large
    // clips). Fall back to chunked mp4box streaming if ffmpeg fails.
    const extracted: GpmfExtractResult = await withGpmfExtractionGuard(() =>
      extractGpmfViaFfmpeg(filePath, gpmfExtract as GpmfExtractFn).catch(() =>
        extractGpmfStreaming(filePath, gpmfExtract as GpmfExtractFn),
      ),
    );

    const telemetry: GoproTelemetryResult = await new Promise((resolve, reject) => {
      goproTelemetry(extracted, { repeatSticky: true }, (data: GoproTelemetryResult) => {
        try { resolve(data); } catch (e) { reject(e); }
      });
    });

    const startTime = extracted.timing?.start ?? new Date();
    const brand = inferGoproBrand(telemetry);
    const track = emptyTrack('gopro', brand, startTime);
    track.meta = { firmware: getFirmware(telemetry) };

    // Accumulate samples by offsetMs across streams using a sparse map.
    const rowsByOffset = new Map<number, Record<string, number | undefined>>();

    const ingest = (
      streamKey: string,
      fieldMap: (value: unknown) => Record<string, number | undefined> | null,
    ) => {
      for (const deviceId of Object.keys(telemetry)) {
        const stream = telemetry[deviceId]?.streams?.[streamKey];
        if (!stream?.samples?.length) continue;
        for (const s of stream.samples) {
          if (s.cts === undefined) continue;
          const offsetMs = Math.round(s.cts);
          const mapped = fieldMap(s.value);
          if (!mapped) continue;
          const row = rowsByOffset.get(offsetMs) ?? {};
          for (const [k, v] of Object.entries(mapped)) row[k] = v;
          rowsByOffset.set(offsetMs, row);
        }
      }
    };

    ingest('GPS5', (v) => {
      if (!Array.isArray(v)) return null;
      const arr = v as number[];
      const [lat, lon, alt, _2d, speed] = arr;
      return { lat, lon, alt, speed };
    });

    ingest('GPS9', (v) => {
      if (!Array.isArray(v)) return null;
      const arr = v as number[];
      const [lat, lon, alt, speed2d, speed3d] = arr;
      return { lat, lon, alt, speed: speed3d ?? speed2d };
    });

    ingest('ACCL', (v) => {
      if (!Array.isArray(v) || v.length < 3) return null;
      const [x, y, z] = v as number[];
      return { accelX: x, accelY: y, accelZ: z };
    });

    ingest('GYRO', (v) => {
      if (!Array.isArray(v) || v.length < 3) return null;
      const [x, y, z] = v as number[];
      return { gyroX: x, gyroY: y, gyroZ: z };
    });

    ingest('TMPC', (v) => {
      if (typeof v === 'number') return { temp: v };
      if (Array.isArray(v) && typeof v[0] === 'number') return { temp: v[0] as number };
      return null;
    });

    if (rowsByOffset.size === 0) {
      track.warnings.push('No telemetry samples found in GPMF stream.');
      return finalizeTrack(track);
    }

    for (const [offsetMs, row] of rowsByOffset) {
      pushFrame(track, offsetMs, row);
    }

    finalizeTrack(track);

    if (!track.fields.includes('lat')) {
      track.warnings.push(
        'No GPS samples in this GoPro file (common on Hero12 — IMU only).',
      );
    }

    return track;
  }
}

function inferGoproBrand(t: GoproTelemetryResult): string {
  for (const deviceId of Object.keys(t)) {
    const cam = t[deviceId]?.data?.CameraType;
    if (cam) return `GoPro ${cam}`;
  }
  return 'GoPro (unknown model)';
}

function getFirmware(t: GoproTelemetryResult): string | undefined {
  for (const deviceId of Object.keys(t)) {
    const fw = t[deviceId]?.data?.FirmwareVersion;
    if (fw) return fw;
  }
  return undefined;
}

type GpmfExtractFn = (
  file: Buffer | ((mp4boxFile: Mp4BoxLike) => void),
) => Promise<GpmfExtractResult>;

/** Minimal subset of mp4box.js's ISOFile used by gpmf-extract. */
interface Mp4BoxLike {
  appendBuffer: (buffer: ArrayBuffer) => void;
  flush: () => void;
}

/**
 * gpmf-extract can throw synchronously inside mp4box callbacks (e.g.
 * Buffer.alloc when memory is tight). That bypasses promise rejection and
 * leaves IPC handlers without a reply — catch those during extraction.
 */
function withGpmfExtractionGuard<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const onUncaught = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => process.off('uncaughtException', onUncaught);
    process.on('uncaughtException', onUncaught);
    fn().then(
      (value) => { cleanup(); resolve(value); },
      (err) => { cleanup(); reject(err); },
    );
  });
}

function pickGpmdStream(probe: FfprobeResult) {
  return pickDataStreams(probe).find((s) => {
    if (s.codec_tag_string === 'gpmd') return true;
    if (s.handler_name && /gopro met/i.test(s.handler_name)) return true;
    return false;
  });
}

async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

/**
 * Demux only the gpmd metadata track with ffmpeg, then parse the small
 * sidecar file with gpmf-extract. Peak memory stays low even for multi-GB
 * source clips.
 */
async function extractGpmfViaFfmpeg(
  filePath: string,
  gpmfExtract: GpmfExtractFn,
): Promise<GpmfExtractResult> {
  const probe = await ffprobe(filePath);
  const gpmd = pickGpmdStream(probe);
  if (!gpmd) throw new Error('No GPMF (gpmd) metadata stream found');

  const tempDir = await mkdtemp(join(tmpdir(), 'dg-gpmd-'));
  const outPath = join(tempDir, 'gpmd.mp4');
  try {
    await runFfmpeg([
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', filePath,
      '-map', `0:${gpmd.index}`,
      '-c', 'copy',
      outPath,
    ]);
    return await gpmfExtract(await readFile(outPath));
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractGpmfStreaming(
  filePath: string,
  gpmfExtract: GpmfExtractFn,
): Promise<GpmfExtractResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    gpmfExtract((mp4boxFile: Mp4BoxLike) => {
      streamFileIntoMp4Box(filePath, mp4boxFile).catch((err) => {
        finish(() => reject(err));
      });
    })
      .then((result) => finish(() => resolve(result)))
      .catch((err) => finish(() => reject(err)));
  });
}

/**
 * Stream a file from disk into mp4box.js in chunks. Fallback when ffmpeg
 * demux fails; never loads the entire source clip into memory.
 *
 * mp4box.js requires each ArrayBuffer to carry its absolute byte
 * offset in a `fileStart` property — that's how the parser locates
 * the moov atom (which may be at the end of the file for GoPros that
 * weren't faststart-optimized) before emitting samples.
 */
async function streamFileIntoMp4Box(filePath: string, mp4boxFile: Mp4BoxLike): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, {
      highWaterMark: GPMF_STREAM_CHUNK_BYTES,
    });
    let offset = 0;

    stream.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer & { fileStart?: number };
      ab.fileStart = offset;
      mp4boxFile.appendBuffer(ab);
      offset += buf.byteLength;
    });
    stream.on('end', () => {
      mp4boxFile.flush();
      resolve();
    });
    stream.on('error', reject);
  });
}
