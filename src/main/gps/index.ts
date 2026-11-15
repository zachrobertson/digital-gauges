/**
 * Camera GPS: fast probe + on-demand extraction, used only for sync.
 *
 * The probe answers "does this file have usable GPS?" by reading the MP4 index
 * and a few telemetry samples (or the Insta360 footer) — never the video data.
 * Extraction runs only when the user asks for GPS alignment.
 */
import type { CameraGpsProbe, CameraGpsTrack } from '../../shared/types/gps';
import { extractGoPro, findGpmdTrack, probeGoPro } from './gopro';
import { extractInsta360, probeInsta360, readInsta360Trailer } from './insta360';
import { readMp4Index } from './mp4';
import { GpsReadAbort, RangeReader } from './reader';

/** The probe may read at most this much (moov of a long clip + a few payloads). */
const PROBE_BUDGET_BYTES = 80 * 1024 * 1024;
/** Extraction budget: GPS payloads + moov; generous but never a full multi-GB video. */
const EXTRACT_BUDGET_BYTES = 256 * 1024 * 1024;
const EXTRACT_TIMEOUT_MS = 60_000;

type ProbeBody = Omit<CameraGpsProbe, 'bytesRead' | 'elapsedMs'>;

async function probeWith(reader: RangeReader): Promise<ProbeBody> {
  // Insta360 first: the footer check is 72 bytes, and its files are also valid MP4s.
  const trailer = await readInsta360Trailer(reader);
  if (trailer) return probeInsta360(reader, trailer);

  const index = await readMp4Index(reader);
  if (!index) {
    return { status: 'no-gps', format: null, experimental: false, reason: 'Not an MP4/MOV file with readable metadata.' };
  }

  const gpmd = findGpmdTrack(index);
  if (gpmd) return probeGoPro(reader, gpmd);

  if (index.tracks.some((t) => t.format === 'djmd' || /dji\s*meta/i.test(t.handlerName))) {
    return {
      status: 'unsupported',
      format: 'dji',
      experimental: false,
      reason: 'DJI telemetry track found, but DJI GPS decoding is not supported yet.',
    };
  }
  if (index.tracks.some((t) => t.format === 'camm' || /camera\s*motion/i.test(t.handlerName))) {
    return {
      status: 'unsupported',
      format: 'camm',
      experimental: false,
      reason: 'CAMM telemetry track found, but CAMM GPS decoding is not supported yet.',
    };
  }

  return {
    status: 'no-gps',
    format: null,
    experimental: false,
    reason: 'No camera telemetry in this file (exported or re-encoded videos usually lose it).',
  };
}

export async function probeCameraGps(path: string): Promise<CameraGpsProbe> {
  const t0 = performance.now();
  let reader: RangeReader;
  try {
    reader = await RangeReader.open(path, PROBE_BUDGET_BYTES);
  } catch (e) {
    return {
      status: 'no-gps',
      format: null,
      experimental: false,
      reason: `Couldn't open the video file: ${(e as Error).message}`,
      bytesRead: 0,
      elapsedMs: Math.round(performance.now() - t0),
    };
  }
  try {
    const body = await probeWith(reader);
    return { ...body, bytesRead: reader.bytesRead, elapsedMs: Math.round(performance.now() - t0) };
  } catch (e) {
    const err = e as Error;
    return {
      status: 'no-gps',
      format: null,
      experimental: false,
      reason: err instanceof GpsReadAbort
        ? `Gave up checking for GPS: ${err.message}.`
        : `Couldn't read camera metadata: ${err.message}`,
      bytesRead: reader.bytesRead,
      elapsedMs: Math.round(performance.now() - t0),
    };
  } finally {
    await reader.close();
  }
}

export async function extractCameraGps(
  path: string,
  opts: { signal?: AbortSignal; videoDurationMs?: number } = {},
): Promise<CameraGpsTrack> {
  const t0 = performance.now();
  const timeout = AbortSignal.timeout(EXTRACT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const reader = await RangeReader.open(path, EXTRACT_BUDGET_BYTES, signal);
  try {
    const trailer = await readInsta360Trailer(reader);
    if (trailer) {
      const r = await extractInsta360(reader, trailer, opts.videoDurationMs);
      return finish('insta360', true, r);
    }
    const index = await readMp4Index(reader);
    const gpmd = index && findGpmdTrack(index);
    if (!gpmd) throw new Error('No supported camera GPS in this file.');
    const r = await extractGoPro(reader, gpmd, signal);
    return finish('gopro', false, r);
  } catch (e) {
    if (timeout.aborted) throw new Error(`GPS extraction took longer than ${EXTRACT_TIMEOUT_MS / 1000} s and was stopped.`);
    throw e;
  } finally {
    await reader.close();
  }

  function finish(
    format: CameraGpsTrack['format'],
    experimental: boolean,
    r: { samples: CameraGpsTrack['samples']; model?: string; warnings: string[] },
  ): CameraGpsTrack {
    return {
      format,
      experimental,
      model: r.model,
      samples: r.samples,
      warnings: r.warnings,
      bytesRead: reader.bytesRead,
      elapsedMs: Math.round(performance.now() - t0),
    };
  }
}
