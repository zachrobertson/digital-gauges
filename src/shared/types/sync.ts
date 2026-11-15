/**
 * How an external telemetry track is aligned to the video timeline.
 *
 * Semantics: at video time V, read track sample at local time
 *   (V − offsetMs) × (100 / playSpeedPercent)
 */
export type SyncAnchor = 'videoStart' | 'videoEnd' | 'utc' | 'gps' | 'manual';

/**
 * Anchors whose offset is stored rather than recomputed from media/tracks.
 * `gps` is computed once from camera GPS, then kept like a manual offset.
 */
export function isFixedOffsetAnchor(anchor: SyncAnchor | undefined): boolean {
  return anchor === 'manual' || anchor === 'gps';
}

export interface TrackSyncSettings {
  /** Video time (ms) where track local t=0 begins. */
  offsetMs: number;
  playSpeedPercent: number;
  anchor: SyncAnchor;
}

export const DEFAULT_TRACK_SYNC: TrackSyncSettings = {
  offsetMs: 0,
  playSpeedPercent: 100,
  anchor: 'utc',
};
