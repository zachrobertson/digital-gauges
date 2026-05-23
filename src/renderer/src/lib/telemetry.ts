import type { Project, TelemetryFrame, TelemetryTrack } from '@shared/types';
import { trackOffsetMs } from '@shared/sync';

/**
 * Merge all telemetry tracks into a single frame at `videoTimeMs`,
 * applying per-track offsets.
 *
 * Sample lookup: binary search per track for the largest offsetMs
 * ≤ (videoTimeMs − trackOffset). Last value wins on field collisions —
 * later tracks in the project override earlier ones, which matches the
 * intuitive "FIT data overrides camera GPS" behavior since FIT tracks
 * are typically added second.
 *
 * Offset meaning: at video time V, read a track at local time (V − offset).
 * For FIT, offset is the video timestamp where FIT t=0 begins.
 */
export function frameAtVideoTime(
  project: Project,
  videoTimeMs: number,
): TelemetryFrame {
  const merged: TelemetryFrame = { offsetMs: videoTimeMs };

  for (const track of project.tracks) {
    const offset = trackOffsetMs(project.trackSync, track.id);
    const localT = videoTimeMs - offset;
    const f = sampleAt(track, localT);
    if (!f) continue;
    for (const key of Object.keys(f)) {
      if (key === 'offsetMs') continue;
      merged[key] = f[key];
    }
  }

  const finish = project.course?.finishDistanceM;
  if (finish != null && typeof merged.distance === 'number') {
    merged.distanceToFinish = Math.max(0, finish - merged.distance);
  }

  return merged;
}

/** Binary search for largest sample with offsetMs <= t. */
export function sampleAt(track: TelemetryTrack, tMs: number): TelemetryFrame | null {
  const arr = track.frames;
  if (arr.length === 0) return null;
  if (tMs < arr[0].offsetMs) return null;
  if (tMs >= arr[arr.length - 1].offsetMs) return arr[arr.length - 1];

  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (arr[mid].offsetMs <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return arr[lo];
}

export type RouteScope = 'full' | 'video';

export type LatLonPoint = { lat: number; lon: number };

/** Concatenate all (lat, lon) pairs from the first GPS-bearing track. */
export function buildPolyline(project: Project): LatLonPoint[] {
  const out: LatLonPoint[] = [];
  for (const track of project.tracks) {
    if (!track.fields.includes('lat') || !track.fields.includes('lon')) continue;
    for (const f of track.frames) {
      if (typeof f.lat === 'number' && typeof f.lon === 'number') {
        out.push({ lat: f.lat, lon: f.lon });
      }
    }
    if (out.length > 0) break; // first GPS-bearing track wins
  }
  return out;
}

/**
 * GPS route clipped to the video window [0, durationMs].
 *
 * Resamples merged lat/lon via `frameAtVideoTime` so the route uses the
 * same track/offset logic as the moving cursor (FIT overrides camera GPS).
 */
export function buildVideoPolyline(
  project: Project,
  options?: { stepMs?: number },
): LatLonPoint[] {
  const durationMs = project.video?.durationMs ?? 0;
  if (durationMs <= 0) return [];

  const stepMs = options?.stepMs ?? 250;
  const out: LatLonPoint[] = [];
  const n = Math.max(1, Math.ceil(durationMs / stepMs) + 1);

  for (let i = 0; i < n; i++) {
    const videoT = Math.min(i * stepMs, durationMs);
    const frame = frameAtVideoTime(project, videoT);
    if (typeof frame.lat !== 'number' || typeof frame.lon !== 'number') continue;
    const last = out[out.length - 1];
    if (last && last.lat === frame.lat && last.lon === frame.lon) continue;
    out.push({ lat: frame.lat, lon: frame.lon });
  }
  return out;
}

export function buildRoutePolyline(
  project: Project,
  scope: RouteScope = 'video',
): LatLonPoint[] {
  return scope === 'full' ? buildPolyline(project) : buildVideoPolyline(project);
}
