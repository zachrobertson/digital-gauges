import { CameraExtractor } from './base';
import { FfprobeResult, pickDataStreams } from './ffprobe';
import { extractViaTelemetryParser } from './insta360';
import type { TelemetryTrack } from '../../shared/types';

/**
 * Generic CAMM (Camera Motion Metadata) extractor.
 *
 *   - Google spec used by Insta360 Pro + a few other 360 cameras.
 *   - Cases 2/3/5/6 are the interesting ones: GPS, IMU, accel, gyro.
 *
 * We piggy-back on telemetry-parser, which decodes CAMM internally.
 * Registered last in the detector so brand-specific extractors win
 * first.
 */
export class CammExtractor extends CameraExtractor {
  readonly id = 'camm';
  readonly label = 'CAMM';
  readonly requiresPython = true;

  canHandle(probe: FfprobeResult | null): boolean {
    if (!probe) return false;
    return pickDataStreams(probe).some((s) => {
      if (s.codec_tag_string === 'camm') return true;
      if (s.handler_name && /camera\s*motion/i.test(s.handler_name)) return true;
      return false;
    });
  }

  async extract(filePath: string): Promise<TelemetryTrack> {
    return extractViaTelemetryParser(filePath, 'camm', 'CAMM');
  }
}
