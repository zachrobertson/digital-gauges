import { clipAtGlobalTime, clipDurationMs, globalTimeFromClipLocal } from './timeline';
import { overlaySourceMsAt } from './sync';
import type { TimelineClip, VideoOverlayClip } from './types/project';

/** One contiguous export window where overlay source maps 1:1 to global time. */
export interface OverlayExportSegment {
  overlay: VideoOverlayClip;
  /** Global timeline seconds (inclusive). */
  globalStartSec: number;
  /** Global timeline seconds (exclusive). */
  globalEndSec: number;
  /** Overlay source seconds at globalStartSec. */
  sourceStartSec: number;
}

/**
 * Split an overlay into export segments — one per base-clip span where source
 * advances linearly with global time (manual and timestamp modes).
 */
export function expandOverlayExportSegments(
  overlay: VideoOverlayClip,
  clips: TimelineClip[],
): OverlayExportSegment[] {
  if (clips.length === 0) return [];

  const segments: OverlayExportSegment[] = [];
  let clipGlobalStart = 0;

  for (const clip of clips) {
    const clipDur = clipDurationMs(clip);
    const clipGlobalEnd = clipGlobalStart + clipDur;
    const winStart = overlay.startGlobalMs;
    const winEnd = overlay.endGlobalMs;
    const overlapStart = Math.max(winStart, clipGlobalStart);
    const overlapEnd = Math.min(winEnd, clipGlobalEnd);

    if (overlapEnd > overlapStart) {
      const sourceMs = overlaySourceMsAt(overlapStart, overlay, clips);
      if (sourceMs != null) {
        segments.push({
          overlay,
          globalStartSec: overlapStart / 1000,
          globalEndSec: overlapEnd / 1000,
          sourceStartSec: sourceMs / 1000,
        });
      }
    }

    clipGlobalStart = clipGlobalEnd;
  }

  return segments;
}

/** Distinct overlay media paths in stable order for ffmpeg inputs. */
export function distinctOverlayPaths(overlays: VideoOverlayClip[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const o of overlays) {
    if (seen.has(o.media.path)) continue;
    seen.add(o.media.path);
    paths.push(o.media.path);
  }
  return paths;
}

/** Global ms of clip index start on the concatenated timeline. */
export function clipGlobalStartMs(clips: TimelineClip[], clipIndex: number): number {
  return globalTimeFromClipLocal(clips, clipIndex, 0);
}

/** Re-export helper for tests — clip at global time with start ms. */
export function clipSpanAtIndex(clips: TimelineClip[], clipIndex: number): { startMs: number; endMs: number } {
  const startMs = clipGlobalStartMs(clips, clipIndex);
  const clip = clips[clipIndex];
  return { startMs, endMs: startMs + (clip ? clipDurationMs(clip) : 0) };
}

export function activeClipAtGlobal(clips: TimelineClip[], globalMs: number) {
  return clipAtGlobalTime(clips, globalMs);
}
