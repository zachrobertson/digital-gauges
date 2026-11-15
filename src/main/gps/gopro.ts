import type { CameraGpsProbe, CameraGpsSample } from '../../shared/types/gps';
import { decodeGpmfPayloadGps } from './gpmf';
import type { Mp4Index, Mp4Sample, Mp4Track } from './mp4';
import { GpsReadAbort, type RangeReader } from './reader';

/** Payloads spot-checked by the probe: the first few, then spread through the clip. */
const PROBE_FIRST = 3;
const PROBE_FRACTIONS = [0.25, 0.5, 0.75, 1];
/** A single GPMF payload larger than this is not plausible (they're KBs). */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

export function findGpmdTrack(index: Mp4Index): Mp4Track | undefined {
  return index.tracks.find((t) => t.format === 'gpmd' || /gopro met/i.test(t.handlerName));
}

async function readPayload(reader: RangeReader, s: Mp4Sample): Promise<Buffer> {
  if (s.size > MAX_PAYLOAD_BYTES) throw new Error(`GPMF payload of ${s.size} bytes is implausibly large`);
  return reader.read(s.offset, s.size);
}

function probeIndices(count: number): number[] {
  const out = new Set<number>();
  for (let i = 0; i < Math.min(PROBE_FIRST, count); i++) out.add(i);
  for (const f of PROBE_FRACTIONS) out.add(Math.round(f * (count - 1)));
  return [...out];
}

type ProbeBody = Omit<CameraGpsProbe, 'bytesRead' | 'elapsedMs'>;

/** Spot-check a handful of payloads for a GPS stream with a fix. */
export async function probeGoPro(reader: RangeReader, track: Mp4Track): Promise<ProbeBody> {
  const base = { format: 'gopro' as const, experimental: false };
  if (track.samples.length === 0) {
    return { ...base, status: 'no-gps', reason: 'GoPro telemetry track is empty.' };
  }

  let model: string | undefined;
  let sawGpsStream = false;
  for (const i of probeIndices(track.samples.length)) {
    const gps = decodeGpmfPayloadGps(await readPayload(reader, track.samples[i]!));
    model ??= gps.model;
    if (!gps.hasGpsStream) continue;
    sawGpsStream = true;
    if (gps.points.some((p) => p.fix >= 2)) {
      return { ...base, status: 'available', model, reason: `GPS found${model ? ` (${model})` : ''}.` };
    }
  }

  if (!sawGpsStream) {
    const hero12 = model && /hero\s*12/i.test(model);
    return {
      ...base,
      status: 'no-gps',
      model,
      reason: hero12
        ? 'HERO12 Black has no GPS receiver.'
        : `No GPS stream in this GoPro file${model ? ` (${model})` : ''} — GPS may have been turned off, or the camera has no GPS.`,
    };
  }
  return {
    ...base,
    status: 'no-gps',
    model,
    reason: 'GPS was on but never got a satellite lock in the sampled parts of this clip.',
  };
}

/** Decode every payload's GPS into samples on the source video timeline. */
export async function extractGoPro(
  reader: RangeReader,
  track: Mp4Track,
  signal?: AbortSignal,
): Promise<{ samples: CameraGpsSample[]; model?: string; warnings: string[] }> {
  const samples: CameraGpsSample[] = [];
  const warnings: string[] = [];
  let model: string | undefined;
  let usedGps5 = false;

  for (const s of track.samples) {
    if (signal?.aborted) throw new GpsReadAbort('Cancelled');
    const gps = decodeGpmfPayloadGps(await readPayload(reader, s));
    model ??= gps.model;
    if (gps.points.length === 0) continue;

    // GPS9 carries per-sample UTC. GPS5 only has one GPSU per payload, applied to its first sample.
    const perSampleUtc = gps.points.every((p) => p.utcMs != null);
    if (!perSampleUtc) usedGps5 = true;
    const payloadUtc = gps.points[0]?.utcMs ?? gps.payloadUtcMs;

    for (const p of gps.points) {
      const videoMs = s.timeMs + p.t * s.durationMs;
      const utcMs = perSampleUtc
        ? p.utcMs!
        : payloadUtc != null ? payloadUtc + p.t * s.durationMs : NaN;
      samples.push({ videoMs, utcMs, lat: p.lat, lon: p.lon, speed: p.speed, fix: p.fix });
    }
  }

  if (usedGps5) {
    warnings.push(
      'This camera only records one GPS timestamp per second (GPS5/GPSU), so the GPS offset is only accurate to about ±1–2 s.',
    );
  }
  return { samples, model, warnings };
}
