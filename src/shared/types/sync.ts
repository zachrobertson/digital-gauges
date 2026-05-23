/**
 * How an external telemetry track is aligned to the video timeline.
 *
 * Semantics: at video time V, read track sample at local time
 *   (V − offsetMs) × (100 / playSpeedPercent)
 */
export type SyncAnchor = 'videoStart' | 'videoEnd' | 'utc' | 'manual';

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
