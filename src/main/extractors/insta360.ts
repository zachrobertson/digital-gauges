import { extname } from 'node:path';
import { CameraExtractor } from './base';
import { FfprobeResult } from './ffprobe';
import { runTelemetryParser } from './python';
import { emptyTrack, finalizeTrack, pushFrame } from './util';
import type { TelemetrySource, TelemetryTrack } from '../../shared/types';

/**
 * Insta360 extractor.
 *
 *   - Consumer `.insv` files: binary trailer after magic bytes
 *     (parsed by telemetry-parser).
 *   - Insta360 Pro MP4 files: CAMM track (also handled by
 *     telemetry-parser; in practice the file may be claimed first by
 *     CammExtractor in the registry — both produce equivalent output).
 *
 * Detection rules:
 *   - Extension `.insv` → unconditional match (ffprobe will have failed,
 *     so probe is null and we route by extension only).
 *   - Probe `format.tags.make` contains "Insta360".
 */
export class Insta360Extractor extends CameraExtractor {
  readonly id = 'insta360';
  readonly label = 'Insta360';
  readonly requiresPython = true;

  canHandle(probe: FfprobeResult | null, path: string): boolean {
    if (extname(path).toLowerCase() === '.insv') return true;
    if (!probe) return false;
    const make = probe.format?.tags?.['make']
      ?? probe.format?.tags?.['com.apple.quicktime.make']
      ?? probe.format?.tags?.['MAKE'];
    return !!make && /insta\s*360/i.test(make);
  }

  async extract(filePath: string): Promise<TelemetryTrack> {
    return extractViaTelemetryParser(filePath, 'insta360', 'Insta360');
  }
}

/**
 * Shared helper for any extractor that delegates to telemetry-parser.
 * Lifts the Python output to our normalized TelemetryTrack format.
 */
export async function extractViaTelemetryParser(
  filePath: string,
  source: TelemetrySource,
  fallbackBrand: string,
): Promise<TelemetryTrack> {
  const out = await runTelemetryParser(filePath);

  if (out.error) {
    throw new Error(out.error);
  }

  const brand = [out.brand, out.model].filter(Boolean).join(' ').trim() || fallbackBrand;
  const startTimeMs = out.start_time_unix_ms ?? Date.now();
  const track = emptyTrack(source, brand, new Date(startTimeMs));

  for (const s of out.samples) {
    const offsetMs = s.t_ms ?? 0;
    const row: Record<string, number | undefined> = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === 't_ms') continue;
      row[k] = v;
    }
    pushFrame(track, offsetMs, row);
  }

  track.warnings.push(...(out.warnings ?? []));
  return finalizeTrack(track);
}
