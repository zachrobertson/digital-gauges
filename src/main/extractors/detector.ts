import { extname } from 'node:path';
import { CameraExtractor, DetectionResult } from './base';
import { ffprobe, extractBrandLabel, FfprobeResult } from './ffprobe';
import { GoProExtractor } from './gopro';
import { Insta360Extractor } from './insta360';
import { DJIExtractor } from './dji';
import { CammExtractor } from './camm';
import { SonyExtractor } from './sony';

/**
 * Ordered registry — first extractor whose `canHandle` returns true wins.
 *
 * Order matters: brand-specific extractors come before the generic CAMM
 * extractor so a GoPro / DJI / Sony file is never misrouted.
 */
const REGISTRY: CameraExtractor[] = [
  new GoProExtractor(),
  new Insta360Extractor(),
  new DJIExtractor(),
  new SonyExtractor(),
  new CammExtractor(),
];

export function getExtractorById(id: string): CameraExtractor | undefined {
  return REGISTRY.find((e) => e.id === id);
}

export function listExtractors(): CameraExtractor[] {
  return [...REGISTRY];
}

/**
 * Detect the camera brand for a given video.
 *
 * Algorithm (matches the plan):
 *   1. Pre-route by extension (`.insv` → Insta360, ffprobe will fail).
 *   2. Run ffprobe, read `format.tags.make` + scan data streams.
 *   3. Ask each registered extractor in order; first match wins.
 *   4. Return raw probe for surfaceable diagnostics.
 */
export async function detectCamera(filePath: string): Promise<DetectionResult> {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.insv' || ext === '.lrv') {
    const insta = REGISTRY.find((e) => e.id === 'insta360');
    return {
      extractor: insta ?? null,
      brand: 'Insta360 (consumer)',
      rawProbe: null,
      reason: `Detected by file extension ${ext}`,
    };
  }

  let probe: FfprobeResult | null = null;
  let probeError: string | null = null;
  try {
    probe = await ffprobe(filePath);
  } catch (e) {
    probeError = (e as Error).message;
  }

  if (!probe) {
    return {
      extractor: null,
      brand: null,
      rawProbe: null,
      reason: `ffprobe failed: ${probeError ?? 'unknown error'}`,
    };
  }

  for (const ex of REGISTRY) {
    if (ex.canHandle(probe, filePath)) {
      return {
        extractor: ex,
        brand: extractBrandLabel(probe) ?? ex.label,
        rawProbe: probe,
        reason: `Matched ${ex.id} via probe`,
      };
    }
  }

  return {
    extractor: null,
    brand: extractBrandLabel(probe),
    rawProbe: probe,
    reason: 'No registered extractor matched',
  };
}
