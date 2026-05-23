import type { MediaSource, SyncAnchor, TrackSyncSettings } from './types';
import type { TelemetryTrack } from './types';

/**
 * First non-FIT track with GPS or 3-axis IMU — used for wall-clock fallback
 * when the video container has no creation_time tag.
 */
export function pickCameraTrack(tracks: TelemetryTrack[]): TelemetryTrack | undefined {
  return tracks.find((t) => {
    if (t.source === 'fit') return false;
    if (t.fields.includes('lat') && t.fields.includes('lon')) return true;
    return t.fields.includes('accelX')
      && t.fields.includes('accelY')
      && t.fields.includes('accelZ');
  });
}

/** UTC epoch ms for video t=0 — prefers MP4 creation_time over camera track start. */
export function videoUtcMs(
  video: MediaSource | null,
  cameraTrack?: TelemetryTrack,
): number | null {
  if (video?.creationTime) {
    const ms = new Date(video.creationTime).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  if (cameraTrack?.startTime) {
    const ms = new Date(cameraTrack.startTime).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/** Duration span of a track in local time (ms). */
export function trackSpanMs(track: TelemetryTrack): number {
  if (track.frames.length === 0) return 0;
  return track.frames[track.frames.length - 1].offsetMs;
}

/**
 * Compute offsetMs for a sync anchor.
 *
 * Semantics: at video time V, read track at local time (V − offsetMs).
 */
export function computeOffsetFromAnchor(
  anchor: SyncAnchor,
  video: MediaSource | null,
  track: TelemetryTrack,
  cameraTrack?: TelemetryTrack,
): number {
  switch (anchor) {
    case 'videoStart':
      return 0;
    case 'videoEnd':
      if (!video) return 0;
      return video.durationMs - trackSpanMs(track);
    case 'utc': {
      const videoMs = videoUtcMs(video, cameraTrack);
      const trackMs = new Date(track.startTime).getTime();
      if (videoMs == null || !Number.isFinite(trackMs)) return 0;
      return trackMs - videoMs;
    }
    case 'manual':
      return 0;
  }
}

export function trackOffsetMs(
  trackSync: Record<string, TrackSyncSettings>,
  trackId: string,
): number {
  return trackSync[trackId]?.offsetMs ?? 0;
}

/** Default sync for a FIT track on import — UTC anchor via container timing. */
export function defaultFitTrackSync(
  video: MediaSource | null,
  fitTrack: TelemetryTrack,
  cameraTrack?: TelemetryTrack,
): TrackSyncSettings {
  const anchor: SyncAnchor = 'utc';
  return {
    anchor,
    playSpeedPercent: 100,
    offsetMs: computeOffsetFromAnchor(anchor, video, fitTrack, cameraTrack),
  };
}

/** Default sync for a camera telemetry track (fixed at video t=0). */
export function defaultCameraTrackSync(): TrackSyncSettings {
  return { anchor: 'videoStart', offsetMs: 0, playSpeedPercent: 100 };
}

/**
 * Recompute offsetMs for every non-manual FIT track (e.g. after video load).
 * Returns a new trackSync map; does not mutate the input.
 */
export function refreshAnchoredTrackSync(
  trackSync: Record<string, TrackSyncSettings>,
  tracks: TelemetryTrack[],
  video: MediaSource | null,
  cameraTrack?: TelemetryTrack,
): Record<string, TrackSyncSettings> {
  const next = { ...trackSync };
  for (const t of tracks) {
    if (t.source !== 'fit') continue;
    const sync = next[t.id];
    if (!sync || sync.anchor === 'manual') continue;
    next[t.id] = {
      ...sync,
      offsetMs: computeOffsetFromAnchor(sync.anchor, video, t, cameraTrack),
    };
  }
  return next;
}

/** Human-readable signed duration, e.g. "+5m 12s" or "−1h 3m". */
export function formatOffsetMs(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const abs = Math.abs(Math.round(ms));
  const totalSec = Math.floor(abs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${sign}${h}h ${m}m ${s}s`;
  if (m > 0) return `${sign}${m}m ${s}s`;
  if (abs >= 1000) return `${sign}${s}s`;
  return `${sign}${(abs / 1000).toFixed(1)}s`;
}

/** FIT local sample time (ms) for a given video playhead. */
export function fitSampleTimeMs(videoTimeMs: number, offsetMs: number): number {
  return videoTimeMs - offsetMs;
}

/** Slider bounds wide enough for wall-clock skew plus full track spans. */
export function fitOffsetSliderRange(
  tracks: TelemetryTrack[],
  videoDurationMs: number,
  trackSync: Record<string, TrackSyncSettings>,
): { min: number; max: number } {
  const camera = pickCameraTrack(tracks);
  let span = Math.max(videoDurationMs, 60_000);

  for (const t of tracks) {
    if (t.source !== 'fit') continue;
    const fitDur = trackSpanMs(t);
    span = Math.max(span, fitDur);
    span = Math.max(span, Math.abs(trackOffsetMs(trackSync, t.id)));
    if (camera) {
      const utcOffset = computeOffsetFromAnchor('utc', null, t, camera);
      span = Math.max(span, Math.abs(utcOffset));
    }
  }

  const limit = Math.min(Math.max(span + 60_000, 120_000), 4 * 60 * 60 * 1000);
  return { min: -limit, max: limit };
}

export const SYNC_ANCHOR_LABELS: Record<SyncAnchor, string> = {
  utc: 'UTC (container clock)',
  videoStart: 'Video start',
  videoEnd: 'Video end',
  manual: 'Manual',
};
