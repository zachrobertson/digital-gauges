/**
 * Telemetry data model — bike-computer telemetry from FIT files is the
 * sole data source. Video files are used for picture and timing only;
 * the app no longer extracts telemetry from video.
 *
 * The legacy camera source literals below are retained only so older
 * saved projects still parse; such tracks are stripped on project load.
 *
 * All numeric units are SI:
 *   - speed:  m/s
 *   - power:  W
 *   - hr:     bpm
 *   - cadence: rpm
 *   - alt:    metres
 *   - temp:   °C
 *   - lat / lon: WGS84 decimal degrees
 *   - grade:  fraction (0.05 = 5%)
 *   - leanAngle: radians
 *   - accelX/Y/Z: m/s²
 *   - gyroX/Y/Z: rad/s
 */

export type TelemetrySource =
  | 'gopro'
  | 'insta360'
  | 'dji'
  | 'sony'
  | 'fit'
  | 'camm';

export type TelemetryField =
  | 'speed'
  | 'power'
  | 'cadence'
  | 'hr'
  | 'lat'
  | 'lon'
  | 'alt'
  | 'temp'
  | 'grade'
  | 'distance'
  | 'distanceToFinish'
  | 'leanAngle'
  | 'accelX'
  | 'accelY'
  | 'accelZ'
  | 'gyroX'
  | 'gyroY'
  | 'gyroZ';

export interface TelemetryFrame {
  /** ms from the track's startTime */
  offsetMs: number;
  /** Sparse field values — every key is one of TelemetryField. */
  [field: string]: number | undefined;
}

export interface TelemetryTrack {
  /** Stable id used across the renderer/store for this track. */
  id: string;
  source: TelemetrySource;
  /** Human-readable brand string, e.g. "GoPro HERO13 Black" or "Garmin Edge 1040". */
  brand: string;
  /** Wall-clock time of frames[0] (UTC). */
  startTime: string;          // ISO 8601 — kept as string to survive JSON IPC
  /** Field names actually present in this track (subset of TelemetryField strings). */
  fields: string[];
  /** Sample rate hint, Hz. 0 = irregular. */
  sampleRateHz: number;
  /** Sample rows — sparse, may not contain every field on every row. */
  frames: TelemetryFrame[];
  /** Non-fatal extractor messages, e.g. "No GPS on Hero12". */
  warnings: string[];
  /** Raw extractor diagnostic info, displayed in the data inspector. */
  meta?: Record<string, unknown>;
}
