import { CameraExtractor } from './base';
import { FfprobeResult, pickDataStreams } from './ffprobe';
import { extractViaTelemetryParser } from './insta360';
import type { TelemetryTrack } from '../../shared/types';

/**
 * DJI Action 4/5/6 extractor.
 *
 *   - Telemetry lives in a `djmd` data stream (handler "DJI Meta").
 *   - GPS only populated when the camera is paired with the DJI GPS
 *     Bluetooth Remote — we surface a warning if it's missing.
 *
 * Implementation: delegates to telemetry-parser via the shared Python
 * shim used by Insta360. The library handles DJI's protobuf payloads
 * internally; we just lift the normalized output.
 */
export class DJIExtractor extends CameraExtractor {
  readonly id = 'dji';
  readonly label = 'DJI Action';
  readonly requiresPython = true;

  canHandle(probe: FfprobeResult | null): boolean {
    if (!probe) return false;

    const make = probe.format?.tags?.['com.apple.quicktime.make']
      ?? probe.format?.tags?.['make'];
    if (make && /\bdji\b/i.test(make)) return true;

    return pickDataStreams(probe).some((s) => {
      if (s.codec_tag_string === 'djmd') return true;
      if (s.handler_name && /dji\s*meta/i.test(s.handler_name)) return true;
      return false;
    });
  }

  async extract(filePath: string): Promise<TelemetryTrack> {
    const track = await extractViaTelemetryParser(filePath, 'dji', 'DJI Action');
    if (!track.fields.includes('lat')) {
      track.warnings.push(
        'No GPS — DJI Action records GPS only when paired with the DJI GPS Bluetooth Remote.',
      );
    }
    return track;
  }
}
