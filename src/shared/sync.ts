import type { MediaSource, SyncAnchor, TimelineClip, TrackSyncSettings, VideoOverlayClip } from './types';
import type { TelemetryTrack } from './types';
import {
  clipAtGlobalTime,
  clipDurationMs,
  clipSourceTimeMs,
  overlayInMs,
  overlayOutMs,
  overlayVisibleAt,
} from './timeline';

/** UTC epoch ms for video t=0 — read from the MP4 container creation_time tag. */
export function videoUtcMs(video: MediaSource | null): number | null {
  if (video?.creationTime) {
    const ms = new Date(video.creationTime).getTime();
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
): number {
  switch (anchor) {
    case 'videoStart':
      return 0;
    case 'videoEnd':
      if (!video) return 0;
      return video.durationMs - trackSpanMs(track);
    case 'utc': {
      const videoMs = videoUtcMs(video);
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
): TrackSyncSettings {
  const anchor: SyncAnchor = 'utc';
  return {
    anchor,
    playSpeedPercent: 100,
    offsetMs: computeOffsetFromAnchor(anchor, video, fitTrack),
  };
}

/**
 * Continue the shared FIT timeline from the previous clip when UTC metadata is
 * missing. At clip N local t=0, sample FIT at the same ride time as clip N−1 end.
 */
export function chainedFitOffsetMs(
  prevClip: TimelineClip,
  fitTrackId: string,
): number {
  const prevOffset = trackOffsetMs(prevClip.sharedTrackSync, fitTrackId);
  return prevOffset - clipDurationMs(prevClip);
}

/**
 * Default FIT sync for a clip in a multi-clip timeline.
 * Clip 1 uses UTC wall-clock; later clips chain from the prior clip so one shared
 * FIT file continues across consecutive videos from the same ride.
 */
export function defaultFitTrackSyncForClip(
  clips: TimelineClip[],
  clipIndex: number,
  fitTrack: TelemetryTrack,
): TrackSyncSettings {
  const clip = clips[clipIndex];
  if (!clip) return defaultFitTrackSync(null, fitTrack);

  const anchor: SyncAnchor = 'utc';

  if (clipIndex > 0) {
    const prev = clips[clipIndex - 1];
    if (prev?.sharedTrackSync[fitTrack.id]) {
      return {
        anchor,
        playSpeedPercent: 100,
        offsetMs: chainedFitOffsetMs(prev, fitTrack.id),
      };
    }
  }

  if (videoUtcMs(clip.media) != null) {
    return {
      anchor,
      playSpeedPercent: 100,
      offsetMs: computeOffsetFromAnchor(anchor, clip.media, fitTrack),
    };
  }

  return defaultFitTrackSync(clip.media, fitTrack);
}

/**
 * Re-chain clip 2+ shared FIT sync from the prior clip so one FIT file spans all
 * clips. Skips manual anchors.
 */
export function repairSharedFitSync(
  clips: TimelineClip[],
  sharedTracks: TelemetryTrack[],
): TimelineClip[] {
  const fitTracks = sharedTracks.filter((t) => t.source === 'fit');
  if (fitTracks.length === 0 || clips.length < 2) return clips;

  const next = [...clips];
  let anyChanged = false;

  for (let clipIndex = 1; clipIndex < next.length; clipIndex++) {
    const clip = next[clipIndex]!;
    const prev = next[clipIndex - 1]!;
    const sharedTrackSync = { ...clip.sharedTrackSync };
    let clipChanged = false;

    for (const t of fitTracks) {
      const sync = sharedTrackSync[t.id];
      if (!sync || sync.anchor === 'manual') continue;
      if (!prev.sharedTrackSync[t.id]) continue;
      const chained = chainedFitOffsetMs(prev, t.id);
      if (sync.offsetMs === chained) continue;
      sharedTrackSync[t.id] = { ...sync, offsetMs: chained, anchor: 'utc' };
      clipChanged = true;
    }

    if (clipChanged) {
      next[clipIndex] = { ...clip, sharedTrackSync };
      anyChanged = true;
    }
  }

  return anyChanged ? next : clips;
}

/** Recompute chained offsets for clips after `fromClipIndex` (inclusive). */
export function rechainedSharedFitSyncFrom(
  clips: TimelineClip[],
  fitTrackId: string,
  fromClipIndex: number,
): TimelineClip[] {
  if (fromClipIndex >= clips.length - 1) return clips;

  const next = [...clips];
  for (let i = Math.max(1, fromClipIndex + 1); i < next.length; i++) {
    const clip = next[i]!;
    const prev = next[i - 1]!;
    const sync = clip.sharedTrackSync[fitTrackId];
    if (!sync || sync.anchor === 'manual') continue;
    const chained = chainedFitOffsetMs(prev, fitTrackId);
    if (sync.offsetMs === chained) continue;
    next[i] = {
      ...clip,
      sharedTrackSync: {
        ...clip.sharedTrackSync,
        [fitTrackId]: { ...sync, offsetMs: chained },
      },
    };
  }
  return next;
}

/**
 * Shared FIT offset used for sampling — clip 2+ chains from the prior clip unless
 * the anchor is manual. Keeps one FIT file continuous across consecutive clips.
 */
export function effectiveSharedFitOffsetMs(
  clips: TimelineClip[],
  clipIndex: number,
  fitTrackId: string,
): number {
  const clip = clips[clipIndex];
  if (!clip) return 0;
  const sync = clip.sharedTrackSync[fitTrackId];
  if (!sync) return 0;
  if (sync.anchor === 'manual' || clipIndex === 0) return sync.offsetMs;
  const prev = clips[clipIndex - 1];
  if (!prev?.sharedTrackSync[fitTrackId]) return sync.offsetMs;
  return chainedFitOffsetMs(prev, fitTrackId);
}

/**
 * Recompute offsetMs for every non-manual FIT track (e.g. after video load).
 * Returns a new trackSync map; does not mutate the input.
 */
export function refreshAnchoredTrackSync(
  trackSync: Record<string, TrackSyncSettings>,
  tracks: TelemetryTrack[],
  video: MediaSource | null,
): Record<string, TrackSyncSettings> {
  const next = { ...trackSync };
  for (const t of tracks) {
    if (t.source !== 'fit') continue;
    const sync = next[t.id];
    if (!sync || sync.anchor === 'manual') continue;
    next[t.id] = {
      ...sync,
      offsetMs: computeOffsetFromAnchor(sync.anchor, video, t),
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

/**
 * Offset that pins a known data ride time to a known video time.
 * Inverse of {@link fitSampleTimeMs}: choosing offset = videoMs − dataMs makes
 * `fitSampleTimeMs(videoMs, offset) === dataMs`. Used by "set sync point at
 * frame" in the visual sync workspace.
 */
export function offsetFromSyncPoint(videoMs: number, dataMs: number): number {
  return Math.round(videoMs - dataMs);
}

/** Slider bounds wide enough for wall-clock skew plus full track spans. */
export function fitOffsetSliderRange(
  tracks: TelemetryTrack[],
  videoDurationMs: number,
  trackSync: Record<string, TrackSyncSettings>,
  clipMedia?: MediaSource | null,
): { min: number; max: number } {
  let span = Math.max(videoDurationMs, 60_000);

  for (const t of tracks) {
    if (t.source !== 'fit') continue;
    const fitDur = trackSpanMs(t);
    span = Math.max(span, fitDur);
    span = Math.max(span, Math.abs(trackOffsetMs(trackSync, t.id)));
    const utcOffset = computeOffsetFromAnchor('utc', clipMedia ?? null, t);
    span = Math.max(span, Math.abs(utcOffset));
  }

  const limit = Math.min(Math.max(span + 60_000, 120_000), 4 * 60 * 60 * 1000);
  return { min: -limit, max: limit };
}

/** Recompute shared FIT sync for one clip when media or tracks change. */
export function refreshClipSharedTrackSync(
  sharedTrackSync: Record<string, TrackSyncSettings>,
  sharedTracks: TelemetryTrack[],
  clipMedia: MediaSource,
  clipIndex?: number,
  clips?: TimelineClip[],
): Record<string, TrackSyncSettings> {
  const next = { ...sharedTrackSync };
  for (const t of sharedTracks) {
    if (t.source !== 'fit') continue;
    const sync = next[t.id];
    if (!sync || sync.anchor === 'manual') continue;
    if (
      clipIndex != null
      && clipIndex > 0
      && clips?.[clipIndex - 1]?.sharedTrackSync[t.id]
    ) {
      next[t.id] = {
        ...sync,
        offsetMs: chainedFitOffsetMs(clips[clipIndex - 1]!, t.id),
      };
      continue;
    }
    const utcOffset = computeOffsetFromAnchor(sync.anchor, clipMedia, t);
    next[t.id] = { ...sync, offsetMs: utcOffset };
  }
  return next;
}

export const SYNC_ANCHOR_LABELS: Record<SyncAnchor, string> = {
  utc: 'UTC (container clock)',
  videoStart: 'Video start',
  videoEnd: 'Video end',
  manual: 'Manual',
};

/** UTC epoch ms for the active base clip at global time G. */
export function baseUtcMsAtGlobal(clips: TimelineClip[], globalMs: number): number | null {
  const loc = clipAtGlobalTime(clips, globalMs);
  if (!loc) return null;
  const utc0 = videoUtcMs(loc.clip.media);
  if (utc0 == null) return null;
  return utc0 + clipSourceTimeMs(loc.clip, loc.localMs);
}

/**
 * Overlay source media ms at global G, or null when hidden or outside trimmed source.
 */
export function overlaySourceMsAt(
  globalMs: number,
  overlay: VideoOverlayClip,
  clips: TimelineClip[],
): number | null {
  if (!overlayVisibleAt(globalMs, overlay)) return null;

  const offsetMs = overlay.offsetMs ?? 0;
  let sourceMs: number;

  if (overlay.alignMode === 'manual') {
    sourceMs = overlayInMs(overlay) + (globalMs - overlay.startGlobalMs) + offsetMs;
  } else {
    const baseUtc = baseUtcMsAtGlobal(clips, globalMs);
    const overlayUtc = videoUtcMs(overlay.media);
    if (baseUtc == null || overlayUtc == null) return null;
    sourceMs = baseUtc - overlayUtc + offsetMs;
  }

  const inMs = overlayInMs(overlay);
  const outMs = overlayOutMs(overlay);
  if (sourceMs < inMs || sourceMs >= outMs) return null;
  return sourceMs;
}

/**
 * Offset (ms) that aligns overlay UTC to base UTC at global G — seeds timestamp mode on add.
 * At G, overlay source should read `desiredSourceMs` (typically overlayInMs).
 */
export function computeTimestampOverlayOffset(
  clips: TimelineClip[],
  overlay: VideoOverlayClip,
  globalMs: number,
  desiredSourceMs?: number,
): number | null {
  const inMs = desiredSourceMs ?? overlayInMs(overlay);
  const baseUtc = baseUtcMsAtGlobal(clips, globalMs);
  const overlayUtc = videoUtcMs(overlay.media);
  if (baseUtc == null || overlayUtc == null) return null;
  return Math.round(inMs - (baseUtc - overlayUtc));
}
