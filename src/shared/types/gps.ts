/**
 * Camera GPS — used only to find the video's true UTC start time for syncing
 * FIT data. Camera telemetry is never merged into gauges.
 */

/** Container formats we know how to look for GPS in. */
export type CameraGpsFormat = 'gopro' | 'insta360' | 'dji' | 'camm';

/**
 * Result of the fast probe:
 * - `available`: GPS samples with a satellite fix were found.
 * - `no-gps`: the file definitely has no usable GPS (no track, no record, no fix).
 * - `unsupported`: GPS may exist but this format isn't decoded yet.
 */
export type CameraGpsProbeStatus = 'available' | 'no-gps' | 'unsupported';

export interface CameraGpsProbe {
  status: CameraGpsProbeStatus;
  format: CameraGpsFormat | null;
  /** Camera model when the file names it (e.g. "HERO12 Black", "Insta360 X6"). */
  model?: string;
  /** Decoder is implemented from the spec but untested against real files. */
  experimental: boolean;
  /** Human-readable explanation shown in the Sync panel. */
  reason: string;
  /** Bytes read from disk to reach this answer. */
  bytesRead: number;
  elapsedMs: number;
}

export interface CameraGpsSample {
  /** Source video time (ms from the start of the untrimmed file). */
  videoMs: number;
  /** GPS UTC time of this sample (epoch ms). */
  utcMs: number;
  lat: number;
  lon: number;
  /** Ground speed, m/s. */
  speed?: number;
  /** 0 = no lock, 2 = 2D, 3 = 3D. */
  fix: number;
}

export interface CameraGpsTrack {
  format: CameraGpsFormat;
  model?: string;
  experimental: boolean;
  samples: CameraGpsSample[];
  warnings: string[];
  bytesRead: number;
  elapsedMs: number;
}

/** Stored on MediaSource after a successful GPS alignment. */
export interface GpsClockInfo {
  /** UTC epoch ms of source video t=0, derived from camera GPS. */
  videoStartUtcMs: number;
  format: CameraGpsFormat;
  model?: string;
  experimental: boolean;
  /** Fixed samples the estimate was based on. */
  fixSamples: number;
  /** Spread (p90 − p10) of the per-sample estimates, ms. Lower = more consistent. */
  spreadMs: number;
  warnings: string[];
  /** ISO timestamp of when the estimate was computed. */
  computedAt: string;
}
