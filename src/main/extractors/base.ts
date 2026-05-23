import type { TelemetryTrack } from '../../shared/types';
import type { FfprobeResult } from './ffprobe';

/**
 * Contract every camera-side telemetry extractor implements. Each
 * extractor advertises which probe results it can handle, then the
 * detector picks the winner deterministically.
 */
export abstract class CameraExtractor {
  /** Stable id, e.g. 'gopro' / 'insta360' / 'dji' / 'sony' / 'camm'. */
  abstract readonly id: string;

  /** Human-readable label shown in the UI. */
  abstract readonly label: string;

  /**
   * True if this extractor needs a Python interpreter + telemetry-parser
   * installed on the user's system. GoPro is pure-Node and returns false.
   */
  abstract readonly requiresPython: boolean;

  /**
   * Probe-only decision — fast, no parsing. Implementations should be
   * cheap (just inspect tags/handler/extension) so the detector can run
   * them in priority order without side effects.
   *
   * @param probe  ffprobe JSON output (may be null when ffprobe failed,
   *               e.g. for `.insv` files which aren't valid MP4).
   * @param path   Absolute file path — useful for extension checks.
   */
  abstract canHandle(probe: FfprobeResult | null, path: string): boolean;

  /**
   * Extract telemetry. Should never throw for "no GPS" or "no IMU" —
   * those should surface as warnings on the returned track instead.
   * Only throw for truly fatal conditions (file unreadable, parser
   * crash, missing Python, etc.).
   */
  abstract extract(filePath: string): Promise<TelemetryTrack>;
}

/** Result returned by the brand detector. */
export interface DetectionResult {
  extractor: CameraExtractor | null;
  brand: string | null;
  rawProbe: FfprobeResult | null;
  reason: string;
}
