export type ExportResolution = 'source' | '1080p' | '4k';

export const EXPORT_1080P = { width: 1920, height: 1080 } as const;
export const EXPORT_4K = { width: 3840, height: 2160 } as const;

/** Output dimensions for a given resolution preset. */
export function resolveExportDimensions(
  sourceWidth: number,
  sourceHeight: number,
  resolution: ExportResolution,
): { width: number; height: number } {
  switch (resolution) {
    case '1080p':
      return { ...EXPORT_1080P };
    case '4k':
      return { ...EXPORT_4K };
    default:
      return { width: sourceWidth, height: sourceHeight };
  }
}

export function isUpscaleTo4k(
  sourceWidth: number,
  sourceHeight: number,
  resolution: ExportResolution,
): boolean {
  return resolution === '4k' && (sourceWidth < EXPORT_4K.width || sourceHeight < EXPORT_4K.height);
}

/** Sensible fps for export settings (avoids long fractional tails). */
export function roundExportFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 30;
  const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
  let best = fps;
  let bestErr = Infinity;
  for (const c of common) {
    const err = Math.abs(fps - c);
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  return bestErr < 0.05 ? best : Math.round(fps * 1000) / 1000;
}
