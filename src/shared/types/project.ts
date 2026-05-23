import type { ExportResolution } from '../export';
import type { GaugeInstance } from './gauge';
import type { TelemetryTrack } from './telemetry';
import type { TrackSyncSettings } from './sync';

export interface MediaSource {
  /** Stable id used inside a Project. */
  id: string;
  /** Absolute on-disk path. */
  path: string;
  /** Original filename for display. */
  filename: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  /** ISO 8601 UTC from ffprobe format.tags.creation_time, when present. */
  creationTime?: string;
}

export interface CourseSettings {
  startDistanceM: number | null;
  finishDistanceM: number | null;
  startMarkerVideoMs?: number | null;
  finishMarkerVideoMs?: number | null;
}

export interface Project {
  /** Schema version — bumped when the format changes incompatibly. */
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;

  video: MediaSource | null;
  /** Telemetry tracks attached to this project, in import order. */
  tracks: TelemetryTrack[];
  /** Per-track sync: offset, play speed, and anchor mode. */
  trackSync: Record<string, TrackSyncSettings>;

  /** Placed gauges, lowest z first. */
  gauges: GaugeInstance[];

  /** Start/finish line distances sampled from FIT cumulative distance. */
  course?: CourseSettings;

  /** Render output config. */
  export: ExportSettings;
}

export type ExportCodec = 'h264' | 'hevc' | 'prores4444';

export interface ExportSettings {
  codec: ExportCodec;
  crf: number;          // 18 is visually lossless H.264
  fps: number;          // typically inherits from source
  /** Output size preset — `source` matches probed video dimensions (e.g. 3840×2160). */
  resolution: ExportResolution;
  outputPath: string | null;
}
