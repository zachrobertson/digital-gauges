import { CameraExtractor } from './base';
import { FfprobeResult, pickDataStreams } from './ffprobe';
import { extractViaTelemetryParser } from './insta360';
import type { TelemetryTrack } from '../../shared/types';

/**
 * Sony XAVC RTMD extractor — delegates to telemetry-parser.
 *
 * Telemetry lives in an `rtmd` data stream (handler "SonyMetadata").
 */
export class SonyExtractor extends CameraExtractor {
  readonly id = 'sony';
  readonly label = 'Sony';
  readonly requiresPython = true;

  canHandle(probe: FfprobeResult | null): boolean {
    if (!probe) return false;

    const make = probe.format?.tags?.['com.apple.quicktime.make']
      ?? probe.format?.tags?.['make'];
    if (make && /\bsony\b/i.test(make)) return true;

    return pickDataStreams(probe).some((s) => {
      if (s.codec_tag_string === 'rtmd') return true;
      if (s.handler_name && /sony\s*metadata/i.test(s.handler_name)) return true;
      return false;
    });
  }

  async extract(filePath: string): Promise<TelemetryTrack> {
    return extractViaTelemetryParser(filePath, 'sony', 'Sony XAVC');
  }
}
