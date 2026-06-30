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

export interface TimelineClip {
  id: string;
  media: MediaSource;
  /** Clip-local telemetry (camera from video, optional clip-specific FIT). */
  localTracks: TelemetryTrack[];
  localTrackSync: Record<string, TrackSyncSettings>;
  /** Sync for project.sharedTracks — keyed by shared track id. */
  sharedTrackSync: Record<string, TrackSyncSettings>;
  /** Trim in-point (source ms). Defaults to 0 when absent. */
  inMs?: number;
  /** Trim out-point (source ms). Defaults to media.durationMs when absent. */
  outMs?: number;
  /** Global timeline ms where the trimmed clip window starts. */
  startGlobalMs?: number;
}

export type VideoOverlayAlignMode = 'timestamp' | 'manual';

export interface VideoOverlayClip {
  id: string;
  media: MediaSource;
  /** Global timeline ms where overlay becomes visible. */
  startGlobalMs: number;
  /** Global timeline ms where overlay hides (inclusive start, exclusive end). */
  endGlobalMs: number;
  /** Source trim window. */
  inMs?: number;
  outMs?: number;
  alignMode: VideoOverlayAlignMode;
  /** Manual mode: shifts source mapping. Timestamp mode: fine-tune after UTC auto-align. */
  offsetMs?: number;
  /** Normalized 0–1 rect on output frame (same convention as gauge rects). */
  rect: { x: number; y: number; w: number; h: number };
  z: number;
  /** Whether this overlay's audio is mixed into export. Default false. */
  includeAudio?: boolean;
  opacity?: number;
}

export interface CourseSettings {
  startDistanceM: number | null;
  finishDistanceM: number | null;
  /** Global timeline ms (concatenated clip sequence). */
  startMarkerVideoMs?: number | null;
  finishMarkerVideoMs?: number | null;
}

export interface Project {
  /** Schema version — bumped when the format changes incompatibly. */
  version: 5;
  id: string;
  createdAt: string;
  updatedAt: string;

  /** Ordered clips — play/export back-to-back with no gaps. */
  clips: TimelineClip[];
  /** PiP / B-roll overlays on the global timeline. */
  overlays: VideoOverlayClip[];
  /** FIT (or other) tracks shared across clips. */
  sharedTracks: TelemetryTrack[];

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
  /** When false, export video only (no source or overlay audio). Default true. */
  includeAudio?: boolean;
  outputPath: string | null;
}
