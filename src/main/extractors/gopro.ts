import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { CameraExtractor } from './base';
import { FfprobeResult, pickDataStreams } from './ffprobe';
import type { TelemetryTrack } from '../../shared/types';
import { emptyTrack, finalizeTrack, pushFrame } from './util';

const GPMF_STREAM_CHUNK_BYTES = 4 * 1024 * 1024;
/** Node's fs.readFile rejects above 2 GiB — stream earlier to stay safe. */
const GPMF_BUFFER_THRESHOLD_BYTES = 1024 * 1024 * 1024;

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

    const { size } = await stat(filePath);

    // For files <1.5 GB use the simple Buffer path — fastest, single
    // syscall. For larger files Node's fs.readFile errors with
    // ERR_FS_FILE_TOO_LARGE above 2 GB; we fall back to streaming
    // the file through mp4box.js via gpmf-extract's callback API.
    const useStreaming = size >= GPMF_BUFFER_THRESHOLD_BYTES;

    const extracted: GpmfExtractResult = useStreaming
      ? await extractGpmfStreaming(filePath, gpmfExtract as GpmfExtractFn)
      : await gpmfExtract(await readFileFully(filePath));

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
 * Stream a large MP4 into gpmf-extract and surface read/parse failures
 * to the caller instead of silently returning empty telemetry.
 */
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

async function readFileFully(filePath: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  return readFile(filePath);
}

/**
 * Stream a file from disk into mp4box.js in chunks. Used for >1.5 GB
 * GoPro recordings where Node's `fs.readFile` errors with
 * ERR_FS_FILE_TOO_LARGE.
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
