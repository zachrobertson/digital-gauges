import type { MediaSource, Project, TimelineClip, VideoOverlayClip } from './types/project';

export interface ClipLocation {
  clip: TimelineClip;
  clipIndex: number;
  localMs: number;
  clipStartMs: number;
}

/** Trim in-point (source ms) for a clip — 0 when untrimmed. */
export function clipInMs(clip: TimelineClip): number {
  return Math.max(0, clip.inMs ?? 0);
}

/** Trim out-point (source ms) for a clip — full media duration when untrimmed. */
export function clipOutMs(clip: TimelineClip): number {
  const out = clip.outMs ?? clip.media.durationMs;
  return Math.min(clip.media.durationMs, Math.max(clipInMs(clip), out));
}

/** Visible (trimmed) duration of a clip on the timeline. */
export function clipDurationMs(clip: TimelineClip): number {
  return Math.max(0, clipOutMs(clip) - clipInMs(clip));
}

/** Map a clip-local (timeline) ms to a source-media ms, honoring trim. */
export function clipSourceTimeMs(clip: TimelineClip, localMs: number): number {
  const dur = clipDurationMs(clip);
  const clamped = Math.max(0, Math.min(localMs, dur));
  return clipInMs(clip) + clamped;
}

/**
 * Global timeline start for a clip. Legacy projects without `startGlobalMs`
 * fall back to contiguous placement by trimmed duration.
 */
export function clipStartGlobalMs(clips: TimelineClip[], clipIndex: number): number {
  const clip = clips[clipIndex];
  if (!clip) return 0;
  if (typeof clip.startGlobalMs === 'number' && Number.isFinite(clip.startGlobalMs)) {
    return Math.max(0, clip.startGlobalMs);
  }
  let start = 0;
  for (let i = 0; i < clipIndex; i++) {
    start += clipDurationMs(clips[i]!);
  }
  return start;
}

/** Global timeline end for a clip (exclusive). */
export function clipEndGlobalMs(clips: TimelineClip[], clipIndex: number): number {
  const clip = clips[clipIndex];
  if (!clip) return 0;
  return clipStartGlobalMs(clips, clipIndex) + clipDurationMs(clip);
}

/** Assign contiguous `startGlobalMs` when missing (legacy / migration). */
export function assignClipTimelinePositions(clips: TimelineClip[]): TimelineClip[] {
  let nextStart = 0;
  let changed = false;
  const next = clips.map((clip) => {
    if (typeof clip.startGlobalMs === 'number' && Number.isFinite(clip.startGlobalMs)) {
      nextStart = Math.max(nextStart, clip.startGlobalMs + clipDurationMs(clip));
      return clip;
    }
    changed = true;
    const startGlobalMs = nextStart;
    nextStart += clipDurationMs(clip);
    return { ...clip, startGlobalMs };
  });
  return changed ? next : clips;
}

/** Sum of all clip (trimmed) durations — preview concat length, no gaps. */
export function totalDurationMs(clips: TimelineClip[]): number {
  return clips.reduce((sum, c) => sum + clipDurationMs(c), 0);
}

/**
 * Clamp a clip's desired global start so it cannot overlap its neighbors in the
 * current order. Gaps are allowed; the clip is confined to the free span between
 * the previous clip's end and the next clip's start.
 */
export function clampClipStartGlobalMs(
  clips: TimelineClip[],
  clipIndex: number,
  desiredStartMs: number,
): number {
  const clip = clips[clipIndex];
  if (!clip) return Math.max(0, desiredStartMs);
  const dur = clipDurationMs(clip);
  const lower = clipIndex > 0 ? clipEndGlobalMs(clips, clipIndex - 1) : 0;
  const upper = clipIndex < clips.length - 1
    ? clipStartGlobalMs(clips, clipIndex + 1) - dur
    : Number.POSITIVE_INFINITY;
  // If neighbors leave no room, pin to the lower bound.
  const hi = Number.isFinite(upper) ? Math.max(lower, upper) : Number.POSITIVE_INFINITY;
  return Math.max(lower, Math.min(desiredStartMs, hi));
}

/**
 * Push clips right in array order so none overlap (preserving any gaps that don't
 * cause an overlap). Used after a reorder, where the new adjacency may collide.
 */
export function resolveClipOverlaps(clips: TimelineClip[]): TimelineClip[] {
  let changed = false;
  let cursor = 0;
  const next = clips.map((clip, i) => {
    const current = clipStartGlobalMs(clips, i);
    const start = Math.max(current, cursor);
    cursor = start + clipDurationMs(clip);
    if (start !== clip.startGlobalMs) {
      changed = true;
      return { ...clip, startGlobalMs: start };
    }
    return clip;
  });
  return changed ? next : clips;
}

/** Furthest global ms occupied by any base clip. */
export function timelineEndMs(clips: TimelineClip[]): number {
  let max = 0;
  for (let i = 0; i < clips.length; i++) {
    max = Math.max(max, clipEndGlobalMs(clips, i));
  }
  return max;
}

/** Trim in-point (source ms) for an overlay — 0 when untrimmed. */
export function overlayInMs(overlay: VideoOverlayClip): number {
  return Math.max(0, overlay.inMs ?? 0);
}

/** Trim out-point (source ms) for an overlay — full media duration when untrimmed. */
export function overlayOutMs(overlay: VideoOverlayClip): number {
  const out = overlay.outMs ?? overlay.media.durationMs;
  return Math.min(overlay.media.durationMs, Math.max(overlayInMs(overlay), out));
}

/** Whether global time G is inside the overlay visibility window. */
export function overlayVisibleAt(globalMs: number, overlay: VideoOverlayClip): boolean {
  return globalMs >= overlay.startGlobalMs && globalMs < overlay.endGlobalMs;
}

/** Overlays visible at G, sorted lowest z first. */
export function activeOverlaysAt(globalMs: number, overlays: VideoOverlayClip[]): VideoOverlayClip[] {
  return overlays
    .filter((o) => overlayVisibleAt(globalMs, o))
    .sort((a, b) => a.z - b.z);
}

/** Ruler/export length — max of clip ends and overlay end times. */
export function projectDurationMs(clips: TimelineClip[], overlays: VideoOverlayClip[] = []): number {
  let max = timelineEndMs(clips);
  for (const o of overlays) {
    max = Math.max(max, o.endGlobalMs);
  }
  return max;
}

/** Map global playhead time to clip + local offset. Returns null in timeline gaps. */
export function clipAtGlobalTime(clips: TimelineClip[], globalMs: number): ClipLocation | null {
  if (clips.length === 0) return null;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]!;
    const start = clipStartGlobalMs(clips, i);
    const dur = clipDurationMs(clip);
    const end = start + dur;
    if (globalMs >= start && globalMs < end) {
      return {
        clip,
        clipIndex: i,
        localMs: globalMs - start,
        clipStartMs: start,
      };
    }
  }

  // Past the last clip — clamp to its end for scrub/export edge cases.
  const lastIndex = clips.length - 1;
  const last = clips[lastIndex]!;
  const lastStart = clipStartGlobalMs(clips, lastIndex);
  const lastDur = clipDurationMs(last);
  if (globalMs >= lastStart + lastDur) {
    return {
      clip: last,
      clipIndex: lastIndex,
      localMs: lastDur,
      clipStartMs: lastStart,
    };
  }

  return null;
}

/** Inverse of clipAtGlobalTime — global ms for a clip-local timestamp. */
export function globalTimeFromClipLocal(
  clips: TimelineClip[],
  clipIndex: number,
  localMs: number,
): number {
  const clip = clips[clipIndex];
  if (!clip) return 0;
  const start = clipStartGlobalMs(clips, clipIndex);
  return start + Math.max(0, Math.min(localMs, clipDurationMs(clip)));
}

/** Map global timeline ms → ms within the concatenated preview (skips gaps). */
export function globalMsToContentMs(clips: TimelineClip[], globalMs: number): number {
  let contentMs = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]!;
    const start = clipStartGlobalMs(clips, i);
    const dur = clipDurationMs(clip);
    const end = start + dur;
    if (globalMs < start) return contentMs;
    if (globalMs >= start && globalMs < end) return contentMs + (globalMs - start);
    contentMs += dur;
  }
  return contentMs;
}

/** Inverse of globalMsToContentMs. */
export function contentMsToGlobalMs(clips: TimelineClip[], contentMs: number): number {
  let remaining = Math.max(0, contentMs);
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]!;
    const start = clipStartGlobalMs(clips, i);
    const dur = clipDurationMs(clip);
    if (remaining <= dur) return start + remaining;
    remaining -= dur;
  }
  const lastIndex = clips.length - 1;
  if (lastIndex < 0) return 0;
  return clipEndGlobalMs(clips, lastIndex);
}

/** First clip media — used for layout aspect ratio and export dimensions. */
export function firstClipMedia(project: Project): MediaSource | null {
  return project.clips[0]?.media ?? null;
}

/** Clip start positions on the global timeline (one per clip). */
export function clipBoundariesMs(clips: TimelineClip[]): number[] {
  return clips.map((_, i) => clipStartGlobalMs(clips, i));
}

/**
 * Map preview `<video>` clock → logical global timeline ms.
 * Uses content mapping so timeline gaps do not shift preview sync.
 */
export function previewTimeToGlobalMs(
  currentTimeSec: number,
  previewDurationSec: number,
  clips: TimelineClip[],
): number {
  const contentTotalMs = totalDurationMs(clips);
  if (!Number.isFinite(currentTimeSec) || currentTimeSec <= 0 || contentTotalMs <= 0) return 0;
  if (!Number.isFinite(previewDurationSec) || previewDurationSec <= 0) {
    return contentMsToGlobalMs(clips, Math.round(currentTimeSec * 1000));
  }
  const ratio = Math.min(1, currentTimeSec / previewDurationSec);
  return contentMsToGlobalMs(clips, Math.round(ratio * contentTotalMs));
}

/** Inverse of previewTimeToGlobalMs — seek the preview video for a global playhead. */
export function globalMsToPreviewTimeSec(
  globalMs: number,
  previewDurationSec: number,
  clips: TimelineClip[],
): number {
  const contentTotalMs = totalDurationMs(clips);
  if (contentTotalMs <= 0) return 0;
  const contentMs = globalMsToContentMs(clips, globalMs);
  if (!Number.isFinite(previewDurationSec) || previewDurationSec <= 0) {
    return contentMs / 1000;
  }
  const ratio = contentMs / contentTotalMs;
  return ratio * previewDurationSec;
}
