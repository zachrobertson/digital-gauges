/** Small canvas drawing helpers shared by built-in gauges. */

import { DEFAULT_FONT_FAMILY } from '../lib/fonts';
import {
  type FrameShape,
  type FrameStyleConfig,
  type LegacyCornerStyle,
  panelEllipseGeometry,
  resolveFrameStyle,
} from './frameStyle';

export type { FrameShape, FrameStyleConfig, LegacyCornerStyle } from './frameStyle';
export { panelCircleGeometry, panelEllipseGeometry, resolveFrameStyle, isEllipseFrame } from './frameStyle';

/** @deprecated use FrameShape */
export type PanelShape = LegacyCornerStyle;

export interface PanelStyle {
  bgColor?: string;
  borderColor?: string;
  opacity?: number;
  fontScale?: number;
  fontFamily?: string;
  frameShape?: FrameShape;
  frameCornerRadius?: number;
}

export interface AppearanceConfig extends FrameStyleConfig {
  panelOpacity?: number;
  panelBg?: string;
  panelBorder?: string;
  fontScale?: number;
  fontFamily?: string;
}

const DEFAULT_PANEL_BG = '#0b0d10';
const DEFAULT_PANEL_BORDER = 'transparent';

function shouldStrokeBorder(color: string | undefined): boolean {
  if (!color) return false;
  const c = color.trim().toLowerCase();
  if (c === 'transparent' || c === '#00000000') return false;
  if (/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*0\s*\)$/.test(c)) return false;
  if (/^#[0-9a-f]{8}$/i.test(c)) {
    const alpha = parseInt(c.slice(7, 9), 16);
    if (alpha < 32) return false;
  }
  const rgbaMatch = c.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/);
  if (rgbaMatch && parseFloat(rgbaMatch[4]) < 0.125) return false;
  return true;
}

export function panelStyleFromConfig(config: AppearanceConfig): PanelStyle {
  const { shape, cornerRadius } = resolveFrameStyle(config);
  return {
    bgColor: config.panelBg ?? DEFAULT_PANEL_BG,
    borderColor: config.panelBorder ?? DEFAULT_PANEL_BORDER,
    opacity: config.panelOpacity ?? 0.65,
    fontScale: config.fontScale ?? 1,
    fontFamily: config.fontFamily ?? DEFAULT_FONT_FAMILY,
    frameShape: shape,
    frameCornerRadius: cornerRadius,
  };
}

function buildPanelPath(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  style: PanelStyle,
): void {
  const shape = style.frameShape ?? 'rectangle';
  if (shape === 'ellipse') {
    const { cx, cy, rx, ry } = panelEllipseGeometry(rect);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    return;
  }
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
}

/** Clip drawing to the on-video gauge placement rect (axis-aligned bounding box). */
export function clipGaugeBounds(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
): void {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
}

/** Save/clip/restore wrapper — keeps gauge content inside its video bounding box. */
export function withGaugeBoundsClip<T>(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  draw: () => T,
): T {
  ctx.save();
  clipGaugeBounds(ctx, rect);
  try {
    return draw();
  } finally {
    ctx.restore();
  }
}

/** Clip subsequent drawing to an elliptical panel (no-op for rectangles). Returns restore fn if clipped. */
export function panelContentClip(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  style?: PanelStyle,
): (() => void) | null {
  if (style?.frameShape !== 'ellipse') return null;
  ctx.save();
  buildPanelPath(ctx, rect, style);
  ctx.clip();
  return () => ctx.restore();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function fillPanel(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  style?: PanelStyle,
): void {
  const s = style ?? {};
  buildPanelPath(ctx, rect, s);

  const opacity = s.opacity ?? 0.65;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = s.bgColor ?? DEFAULT_PANEL_BG;
  ctx.fill();
  ctx.restore();

  if (shouldStrokeBorder(s.borderColor ?? DEFAULT_PANEL_BORDER)) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = s.borderColor ?? DEFAULT_PANEL_BORDER;
    ctx.stroke();
  }
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color = 'rgba(255,255,255,0.6)',
  style?: Pick<PanelStyle, 'fontScale' | 'fontFamily'>,
): void {
  const scale = style?.fontScale ?? 1;
  const family = style?.fontFamily ?? DEFAULT_FONT_FAMILY;
  ctx.fillStyle = color;
  ctx.font = `500 ${Math.floor(size * scale)}px ${family}, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(text.toUpperCase(), x, y);
}

export function drawBigNumber(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color = '#ffffff',
  style?: Pick<PanelStyle, 'fontScale' | 'fontFamily'>,
): void {
  const scale = style?.fontScale ?? 1;
  const family = style?.fontFamily ?? DEFAULT_FONT_FAMILY;
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.floor(size * scale)}px ${family}, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

export function unitFont(
  rectH: number,
  style?: Pick<PanelStyle, 'fontScale' | 'fontFamily'>,
): string {
  const scale = style?.fontScale ?? 1;
  const family = style?.fontFamily ?? DEFAULT_FONT_FAMILY;
  return `500 ${Math.floor(rectH * 0.18 * scale)}px ${family}, system-ui, sans-serif`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
