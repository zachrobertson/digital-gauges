import { randomUUID } from 'node:crypto';
import type { TelemetryFrame, TelemetryTrack, TelemetrySource } from '../../shared/types';

export function emptyTrack(
  source: TelemetrySource,
  brand: string,
  startTime: Date | string,
): TelemetryTrack {
  return {
    id: randomUUID(),
    source,
    brand,
    startTime: typeof startTime === 'string' ? startTime : startTime.toISOString(),
    fields: [],
    sampleRateHz: 0,
    frames: [],
    warnings: [],
    meta: {},
  };
}

/** Once frames are populated, recompute fields[] from the union of keys. */
export function finalizeTrack(track: TelemetryTrack): TelemetryTrack {
  const fields = new Set<string>();
  for (const f of track.frames) {
    for (const k of Object.keys(f)) {
      if (k === 'offsetMs') continue;
      if (f[k] !== undefined && Number.isFinite(f[k] as number)) fields.add(k);
    }
  }
  track.fields = [...fields].sort();

  if (track.frames.length > 1) {
    const span = track.frames[track.frames.length - 1].offsetMs - track.frames[0].offsetMs;
    if (span > 0) {
      track.sampleRateHz = Math.round(((track.frames.length - 1) / span) * 1000);
    }
  }

  track.frames.sort((a, b) => a.offsetMs - b.offsetMs);
  return track;
}

export function pushFrame(track: TelemetryTrack, offsetMs: number, fields: Record<string, number | undefined>) {
  const frame: TelemetryFrame = { offsetMs };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && Number.isFinite(v)) frame[k] = v;
  }
  track.frames.push(frame);
}
