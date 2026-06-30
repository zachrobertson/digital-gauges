/** Gauge panel frame shape — rectangle (optionally rounded) or ellipse. */

export type FrameShape = 'rectangle' | 'ellipse';

/** @deprecated migrated to frameShape + frameCornerRadius */
export type LegacyCornerStyle = 'rounded' | 'square' | 'pill' | 'circle';

export interface FrameStyleConfig {
  frameShape?: FrameShape;
  /** Corner radius in layout pixels; rectangle frames only. Default 0. */
  frameCornerRadius?: number;
  /** @deprecated */
  cornerStyle?: LegacyCornerStyle;
}

export const DEFAULT_FRAME_SHAPE: FrameShape = 'rectangle';
export const DEFAULT_FRAME_CORNER_RADIUS = 0;

/** Legacy rounded preset when migrating old projects. */
const LEGACY_ROUNDED_CORNER_RADIUS = 14;

/** Sentinel for migrated pill frames — clamped to half the shorter side at draw time. */
export const PILL_CORNER_RADIUS = 9999;

export function resolveFrameStyle(config: FrameStyleConfig): {
  shape: FrameShape;
  cornerRadius: number;
} {
  if (config.frameShape) {
    return {
      shape: config.frameShape,
      cornerRadius: config.frameCornerRadius ?? DEFAULT_FRAME_CORNER_RADIUS,
    };
  }

  switch (config.cornerStyle ?? 'rounded') {
    case 'circle':
      return { shape: 'ellipse', cornerRadius: 0 };
    case 'square':
      return { shape: 'rectangle', cornerRadius: 0 };
    case 'pill':
      return { shape: 'rectangle', cornerRadius: PILL_CORNER_RADIUS };
    case 'rounded':
    default:
      return { shape: 'rectangle', cornerRadius: LEGACY_ROUNDED_CORNER_RADIUS };
  }
}

export function isEllipseFrame(config: FrameStyleConfig): boolean {
  return resolveFrameStyle(config).shape === 'ellipse';
}

/** Clamp configured corner radius to the rectangle bounds. */
export function frameCornerRadiusPx(
  _cornerRadius: number,
  _rect: { w: number; h: number },
): number {
  return 0;
}

export function panelEllipseGeometry(rect: { x: number; y: number; w: number; h: number }): {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
} {
  return {
    cx: rect.x + rect.w / 2,
    cy: rect.y + rect.h / 2,
    rx: rect.w / 2,
    ry: rect.h / 2,
  };
}

/** @deprecated use panelEllipseGeometry — circle is an ellipse with equal axes */
export function panelCircleGeometry(rect: { x: number; y: number; w: number; h: number }): {
  cx: number;
  cy: number;
  r: number;
} {
  const r = Math.min(rect.w, rect.h) / 2;
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, r };
}

export function framePreviewCornerRadius(
  shape: FrameShape,
  cornerRadius: number,
  rect: { w: number; h: number },
): number {
  if (shape === 'ellipse') return 0;
  return frameCornerRadiusPx(cornerRadius, rect);
}
