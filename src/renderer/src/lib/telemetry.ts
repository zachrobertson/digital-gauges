import type { Project, TelemetryFrame, TelemetryTrack, TimelineClip, TrackSyncSettings } from '@shared/types';
import { effectiveSharedFitOffsetMs } from '@shared/sync';
import { clipAtGlobalTime, clipInMs, totalDurationMs } from '@shared/timeline';

/** Track local sample time from clip-local video ms and sync settings. */
function trackSampleTimeMs(localMs: number, sync: TrackSyncSettings | undefined): number {
  const offset = sync?.offsetMs ?? 0;
  const speed = sync?.playSpeedPercent ?? 100;
  return (localMs - offset) * (100 / speed);
}

/** FIT ride time (ms from FIT file t=0) at global playhead using the active clip's sync. */
export function fitSampleTimeAtGlobalMs(project: Project, globalMs: number): number | null {
  const loc = clipAtGlobalTime(project.clips, globalMs);
  if (!loc) return null;
  const fitTrack = project.sharedTracks.find((t) => t.source === 'fit');
  if (!fitTrack) return null;
  const sync = loc.clip.sharedTrackSync[fitTrack.id];
  const offset = effectiveSharedFitOffsetMs(project.clips, loc.clipIndex, fitTrack.id);
  return trackSampleTimeMs(loc.localMs + clipInMs(loc.clip), sync ? { ...sync, offsetMs: offset } : sync);
}

function mergeTracksAtLocalTime(
  clips: TimelineClip[],
  clipIndex: number,
  localTracks: TelemetryTrack[],
  localTrackSync: Record<string, TrackSyncSettings>,
  sharedTracks: TelemetryTrack[],
  sharedTrackSync: Record<string, TrackSyncSettings>,
  localMs: number,
  /** Trim in-point (source ms) — sync offsets are defined against source time. */
  sourceBaseMs: number,
): TelemetryFrame {
  const merged: TelemetryFrame = { offsetMs: localMs };
  // Sync offsets were established against the untrimmed source clock, so sample
  // telemetry at the source time (inMs + timeline-local ms).
  const sourceMs = localMs + sourceBaseMs;

  for (const track of localTracks) {
    const sync = localTrackSync[track.id];
    const f = sampleAt(track, trackSampleTimeMs(sourceMs, sync));
    if (!f) continue;
    for (const key of Object.keys(f)) {
      if (key === 'offsetMs') continue;
      merged[key] = f[key];
    }
  }

  for (const track of sharedTracks) {
    const sync = sharedTrackSync[track.id];
    const offsetMs = track.source === 'fit'
      ? effectiveSharedFitOffsetMs(clips, clipIndex, track.id)
      : (sync?.offsetMs ?? 0);
    const f = sampleAt(track, trackSampleTimeMs(sourceMs, sync ? { ...sync, offsetMs } : sync));
    if (!f) continue;
    for (const key of Object.keys(f)) {
      if (key === 'offsetMs') continue;
      merged[key] = f[key];
    }
  }

  return merged;
}

/**
 * Merge all telemetry tracks at global timeline time `globalMs`.
 * Local tracks + shared FIT are merged per active clip; later tracks win on collision.
 */
export function frameAtGlobalTime(
  project: Project,
  globalMs: number,
): TelemetryFrame {
  const loc = clipAtGlobalTime(project.clips, globalMs);
  if (!loc) return { offsetMs: globalMs };

  const merged = mergeTracksAtLocalTime(
    project.clips,
    loc.clipIndex,
    loc.clip.localTracks,
    loc.clip.localTrackSync,
    project.sharedTracks,
    loc.clip.sharedTrackSync,
    loc.localMs,
    clipInMs(loc.clip),
  );
  merged.offsetMs = globalMs;

  const finish = project.course?.finishDistanceM;
  if (finish != null && typeof merged.distance === 'number') {
    merged.distanceToFinish = Math.max(0, finish - merged.distance);
  }

  return merged;
}

/** Sample merged telemetry for a specific clip at clip-local time. */
export function frameAtClipLocalTime(
  project: Project,
  clip: TimelineClip,
  localMs: number,
): TelemetryFrame {
  const clipIndex = project.clips.findIndex((c) => c.id === clip.id);
  const merged = mergeTracksAtLocalTime(
    project.clips,
    clipIndex >= 0 ? clipIndex : 0,
    clip.localTracks,
    clip.localTrackSync,
    project.sharedTracks,
    clip.sharedTrackSync,
    localMs,
    clipInMs(clip),
  );
  merged.offsetMs = localMs;

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

/** All tracks in a project (shared + all clip-local). */
export function allProjectTracks(project: Project): TelemetryTrack[] {
  const local = project.clips.flatMap((c) => c.localTracks);
  return [...project.sharedTracks, ...local];
}

/** Concatenate all (lat, lon) pairs from the first GPS-bearing track. */
export function buildPolyline(project: Project): LatLonPoint[] {
  const out: LatLonPoint[] = [];
  for (const track of allProjectTracks(project)) {
    if (!track.fields.includes('lat') || !track.fields.includes('lon')) continue;
    for (const f of track.frames) {
      if (typeof f.lat === 'number' && typeof f.lon === 'number') {
        out.push({ lat: f.lat, lon: f.lon });
      }
    }
    if (out.length > 0) break;
  }
  return out;
}

/**
 * GPS route clipped to the concatenated timeline [0, totalDurationMs].
 */
export function buildVideoPolyline(
  project: Project,
  options?: { stepMs?: number },
): LatLonPoint[] {
  const durationMs = totalDurationMs(project.clips);
  if (durationMs <= 0) return [];

  const stepMs = options?.stepMs ?? 250;
  const out: LatLonPoint[] = [];
  const n = Math.max(1, Math.ceil(durationMs / stepMs) + 1);

  for (let i = 0; i < n; i++) {
    const globalT = Math.min(i * stepMs, durationMs);
    const frame = frameAtGlobalTime(project, globalT);
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

/** First FIT track carrying cumulative distance plus lat/lon, used to place course markers. */
function fitGpsDistanceTrack(project: Project): TelemetryTrack | null {
  for (const t of allProjectTracks(project)) {
    if (
      t.source === 'fit'
      && t.fields.includes('distance')
      && t.fields.includes('lat')
      && t.fields.includes('lon')
    ) {
      return t;
    }
  }
  return null;
}

/**
 * Resolve the (lat, lon) on the GPS track at a given cumulative distance (meters).
 * Used to place the course start/finish line markers on the map.
 */
export function courseMarkerLatLon(project: Project, distanceM: number): LatLonPoint | null {
  const track = fitGpsDistanceTrack(project);
  if (!track) return null;
  const frames = track.frames;
  if (frames.length === 0) return null;

  const distAt = (i: number): number => {
    const d = frames[i].distance;
    return typeof d === 'number' ? d : NaN;
  };
  const pointAt = (i: number): LatLonPoint | null => {
    const f = frames[i];
    return typeof f.lat === 'number' && typeof f.lon === 'number'
      ? { lat: f.lat, lon: f.lon }
      : null;
  };

  const last = frames.length - 1;
  if (!(distanceM > distAt(0))) return pointAt(0);
  if (distanceM >= distAt(last)) return pointAt(last);

  // Binary search for the largest index with distance <= target (distance is cumulative/monotonic).
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (distAt(mid) <= distanceM) lo = mid;
    else hi = mid - 1;
  }

  const a = pointAt(lo);
  const b = pointAt(Math.min(last, lo + 1));
  if (!a) return b;
  if (!b) return a;

  const d0 = distAt(lo);
  const d1 = distAt(Math.min(last, lo + 1));
  const span = d1 - d0;
  const t = span > 0 ? (distanceM - d0) / span : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  };
}

export interface CourseMarkerPoints {
  start: LatLonPoint | null;
  finish: LatLonPoint | null;
}

/** Resolve start/finish line positions (lat/lon) from the project's course distances. */
export function buildCourseMarkers(project: Project): CourseMarkerPoints {
  const course = project.course;
  return {
    start: course?.startDistanceM != null ? courseMarkerLatLon(project, course.startDistanceM) : null,
    finish: course?.finishDistanceM != null ? courseMarkerLatLon(project, course.finishDistanceM) : null,
  };
}
