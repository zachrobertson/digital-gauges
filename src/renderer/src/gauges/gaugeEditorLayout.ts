/** Layout types and geometry for the interactive gauge editor (480×270 reference frame). */
import type { GaugeElement, TextColorChoice, TextIcon, TextSlot, XY } from '@shared/types/gaugeElement';
import { drawTextIcon, textIconWidth } from './textIcons';
import { defaultGaugeElements, normalizeGaugeElements } from '../lib/gaugeElementFactory';
import type { FrameShape } from './frameStyle';
import { framePreviewCornerRadius, panelCircleGeometry, panelEllipseGeometry } from './frameStyle';

export { panelCircleGeometry, panelEllipseGeometry } from './frameStyle';

export type { XY, TextColorChoice, TextSlot, GaugeElement };

export const LAYOUT_REF_W = 480;
export const LAYOUT_REF_H = 270;
export const MIN_RECT_W = 140;
export const MIN_RECT_H = 90;

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextRole = 'label' | 'value' | 'unit';

/** @deprecated Legacy text slot shape — used by barGauge legacy layout path only. */
export interface TextElement {
  visible: boolean;
  pos: XY;
  textOverride: string;
  color: TextColorChoice;
  fontSize: number;
}

export interface BarConfig {
  rect: LayoutRect;
  rounded: boolean;
  color: TextColorChoice;
}

export const MIN_BAR_LENGTH = 20;
export const MIN_BAR_THICKNESS = 4;
export const MIN_MAP_SIZE = 40;

export type GaugeLayoutTemplate = 'telemetry' | 'gps';

export interface GaugeLayoutConfig {
  /** Internal panel bounding box in the 480×270 reference frame. */
  gaugeRect: LayoutRect;
  /** Ordered elements — paint order follows array order. */
  elements: GaugeElement[];
}

export const TEXT_ROLES: TextRole[] = ['label', 'value', 'unit'];

/** Default panel frame within the 480×270 editor canvas. */
export const DEFAULT_GAUGE_RECT: LayoutRect = { x: 100, y: 45, w: 280, h: 180 };

export const DEFAULT_GPS_GAUGE_RECT: LayoutRect = { x: 90, y: 35, w: 300, h: 200 };

export const DEFAULT_GAUGE_LAYOUT: GaugeLayoutConfig = {
  gaugeRect: { ...DEFAULT_GAUGE_RECT },
  elements: defaultGaugeElements(DEFAULT_GAUGE_RECT, 'speed'),
};

export const MAX_ARC_RADIUS = Math.min(LAYOUT_REF_W, LAYOUT_REF_H) / 2;

export function defaultBarConfig(gaugeRect: LayoutRect = DEFAULT_GAUGE_RECT): BarConfig {
  const pad = Math.min(gaugeRect.h, gaugeRect.w) * 0.1;
  const thickness = Math.max(MIN_BAR_THICKNESS, gaugeRect.h * 0.08);
  return {
    rect: {
      x: gaugeRect.x + pad,
      y: gaugeRect.y + gaugeRect.h - pad - thickness,
      w: Math.max(MIN_BAR_LENGTH, gaugeRect.w - pad * 2),
      h: thickness,
    },
    rounded: true,
    color: 'default',
  };
}

export function resolveBarFillColor(bar: BarConfig, fallbackColor: string): string {
  if (!bar.color || bar.color === 'default') return fallbackColor;
  return bar.color;
}

export function defaultMapRect(gaugeRect: LayoutRect): LayoutRect {
  const insetX = gaugeRect.w * 0.08;
  const insetTop = gaugeRect.h * 0.18;
  const insetBottom = gaugeRect.h * 0.08;
  return {
    x: gaugeRect.x + insetX,
    y: gaugeRect.y + insetTop,
    w: Math.max(MIN_MAP_SIZE, gaugeRect.w - insetX * 2),
    h: Math.max(MIN_MAP_SIZE, gaugeRect.h - insetTop - insetBottom),
  };
}

/** Dial degree → point. 0° = bottom, clockwise. */
export function dialPoint(cx: number, cy: number, r: number, deg: number): XY {
  const rad = (deg * Math.PI) / 180;
  return { x: cx - r * Math.sin(rad), y: cy + r * Math.cos(rad) };
}

export function pointToDialDeg(x: number, y: number, cx: number, cy: number): number {
  const dx = x - cx;
  const dy = y - cy;
  let deg = (Math.atan2(-dx, dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = dialPoint(cx, cy, r, startDeg);
  const e = dialPoint(cx, cy, r, endDeg);
  const sweep = ((endDeg - startDeg) + 360) % 360;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

export interface ArcGeometry {
  cx: number;
  cy: number;
  r: number;
  maxR: number;
}

export function arcGeometry(center: XY, radius: number): ArcGeometry {
  const r = clamp(radius, 8, MAX_ARC_RADIUS);
  return { cx: center.x, cy: center.y, r, maxR: MAX_ARC_RADIUS };
}

export const MIN_ARC_TRACK_WIDTH = 2;
export const MAX_ARC_TRACK_WIDTH = 48;

export function arcTrackWidth(radius: number): number {
  const r = clamp(radius, 8, MAX_ARC_RADIUS);
  return Math.max(6, r * 0.16);
}

export function resolveArcTrackWidth(radius: number, trackWidth?: number): number {
  if (trackWidth != null && Number.isFinite(trackWidth)) {
    return clamp(trackWidth, MIN_ARC_TRACK_WIDTH, MAX_ARC_TRACK_WIDTH);
  }
  return arcTrackWidth(radius);
}

/** Selection bounds — outer edge of the stroked arc track, centered on `center`. */
export function arcSelectionBounds(center: XY, radius: number, trackWidth?: number): LayoutRect {
  const r = clamp(radius, 8, MAX_ARC_RADIUS);
  const outer = r + resolveArcTrackWidth(r, trackWidth) / 2;
  return {
    x: center.x - outer,
    y: center.y - outer,
    w: outer * 2,
    h: outer * 2,
  };
}

export function panelRadius(
  frameShape: FrameShape,
  cornerRadius: number,
  rect: LayoutRect,
): number {
  return framePreviewCornerRadius(frameShape, cornerRadius, rect);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function snapToGrid(value: number, gridSize: number, enabled: boolean): number {
  if (!enabled || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

export function snapPointToGrid(point: XY, gridSize: number, enabled: boolean): XY {
  return {
    x: snapToGrid(point.x, gridSize, enabled),
    y: snapToGrid(point.y, gridSize, enabled),
  };
}

export function snapLayoutRect(rect: LayoutRect, gridSize: number, enabled: boolean): LayoutRect {
  return {
    x: snapToGrid(rect.x, gridSize, enabled),
    y: snapToGrid(rect.y, gridSize, enabled),
    w: snapToGrid(rect.w, gridSize, enabled),
    h: snapToGrid(rect.h, gridSize, enabled),
  };
}

/** Move a rect so its center follows a pointer, snapping the center to grid vertices. */
export function snapRectMoveByCenter(
  rect: LayoutRect,
  pointerOrigin: XY,
  pointer: XY,
  gridSize: number,
  enabled: boolean,
): LayoutRect {
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const cx = clamp(
    rect.x + halfW + (pointer.x - pointerOrigin.x),
    halfW,
    LAYOUT_REF_W - halfW,
  );
  const cy = clamp(
    rect.y + halfH + (pointer.y - pointerOrigin.y),
    halfH,
    LAYOUT_REF_H - halfH,
  );
  const snapped = snapPointToGrid({ x: cx, y: cy }, gridSize, enabled);
  return { ...rect, x: snapped.x - halfW, y: snapped.y - halfH };
}

/** Delta to move bounds so their center snaps to grid vertices. */
export function snapBoundsCenterMoveDelta(
  bounds: LayoutRect,
  pointerOrigin: XY,
  pointer: XY,
  gridSize: number,
  enabled: boolean,
): XY {
  const originCenter = {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
  };
  const targetCenter = snapPointToGrid(
    {
      x: originCenter.x + (pointer.x - pointerOrigin.x),
      y: originCenter.y + (pointer.y - pointerOrigin.y),
    },
    gridSize,
    enabled,
  );
  return {
    x: targetCenter.x - originCenter.x,
    y: targetCenter.y - originCenter.y,
  };
}

export function wrap360(v: number): number {
  const n = ((v % 360) + 360) % 360;
  return Math.round(n);
}

export function formatScaleMaxLabel(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  if (v < 10) return v.toFixed(1).replace(/\.0$/, '');
  return Math.round(v).toString();
}

export function layoutToVideoPixel(
  local: XY,
  layout: { gaugeRect: LayoutRect },
  videoRect: { x: number; y: number; w: number; h: number },
): XY {
  const gr = layout.gaugeRect;
  const s = videoLayoutScale(layout, videoRect);
  return {
    x: videoRect.x + (local.x - gr.x) * s,
    y: videoRect.y + (local.y - gr.y) * s,
  };
}

export function videoLayoutScale(
  layout: { gaugeRect: LayoutRect },
  videoRect: { w: number; h: number },
): number {
  const gr = layout.gaugeRect;
  return videoRect.w / gr.w;
}

export function withLayoutVideoTransform(
  ctx: CanvasRenderingContext2D,
  layout: { gaugeRect: LayoutRect },
  videoRect: { x: number; y: number; w: number; h: number },
  draw: () => void,
): void {
  const gr = layout.gaugeRect;
  const s = videoLayoutScale(layout, videoRect);
  ctx.save();
  ctx.translate(videoRect.x, videoRect.y);
  ctx.scale(s, s);
  ctx.translate(-gr.x, -gr.y);
  draw();
  ctx.restore();
}

export interface TextSlotDrawOptions {
  accentColor: string;
  fontFamily?: string;
  fontScale?: number;
  roleText: (role: TextRole) => string;
  skipEmpty?: boolean;
}

/** Draw text readout slots at layout coords — call inside {@link withLayoutVideoTransform}. */
export function drawTextSlotsInLayoutSpace(
  ctx: CanvasRenderingContext2D,
  slots: { label?: TextSlot; value: TextSlot; unit?: TextSlot },
  options: TextSlotDrawOptions,
): void {
  const family = options.fontFamily ?? 'Inter';
  const fontScale = options.fontScale ?? 1;
  const roles: TextRole[] = ['label', 'value', 'unit'];
  for (const role of roles) {
    const el = role === 'label' ? slots.label : role === 'unit' ? slots.unit : slots.value;
    if (!el?.visible) continue;
    const display = role === 'unit'
      ? options.roleText(role)
      : (el.textOverride.trim().length > 0 ? el.textOverride : options.roleText(role));
    if (options.skipEmpty && !display) continue;
    const size = el.fontSize * fontScale;
    const fill = resolveTextColor(el.color, role, options.accentColor);
    const weight = role === 'value' ? 700 : role === 'label' ? 600 : 500;
    ctx.fillStyle = fill;
    ctx.font = `${weight} ${Math.floor(size)}px ${family}, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(display, el.pos.x, el.pos.y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export function drawStaticTextInLayoutSpace(
  ctx: CanvasRenderingContext2D,
  text: string,
  pos: XY,
  fontSize: number,
  color: TextColorChoice,
  accentColor: string,
  fontFamily = 'Inter',
  fontScale = 1,
): void {
  const size = fontSize * fontScale;
  const fill = !color || color === 'default' ? accentColor : color;
  ctx.fillStyle = fill;
  ctx.font = `600 ${Math.floor(size)}px ${fontFamily}, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pos.x, pos.y);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export function drawImageElementInLayoutSpace(
  ctx: CanvasRenderingContext2D,
  pos: XY,
  size: number,
  color: TextColorChoice,
  accentColor: string,
  icon: TextIcon,
  fontScale = 1,
): void {
  if (icon === 'none') return;
  const h = Math.max(2, size * fontScale);
  const w = textIconWidth(icon, h);
  const fill = !color || color === 'default' ? accentColor : color;
  drawTextIcon(ctx, icon, pos.x - w / 2, pos.y, h, fill);
}

export function layoutFrameAspect(layout: GaugeLayoutConfig): number {
  const gr = layout.gaugeRect;
  return gr.w / gr.h;
}

export function relativeHeightForFrameAspect(
  relW: number,
  frameW: number,
  frameH: number,
  videoW: number,
  videoH: number,
): number {
  const frameAspect = frameW / frameH;
  return (relW * videoW) / (frameAspect * videoH);
}

export function relativeWidthForFrameAspect(
  relH: number,
  frameW: number,
  frameH: number,
  videoW: number,
  videoH: number,
): number {
  const frameAspect = frameW / frameH;
  return (relH * frameAspect * videoH) / videoW;
}

export function defaultVideoRectForLayout(
  layout: GaugeLayoutConfig = DEFAULT_GAUGE_LAYOUT,
  videoW = 1920,
  videoH = 1080,
  relW = 0.2,
  relX = 0.04,
  relY = 0.74,
): { x: number; y: number; w: number; h: number } {
  const gr = layout.gaugeRect;
  const h = relativeHeightForFrameAspect(relW, gr.w, gr.h, videoW, videoH);
  return { x: relX, y: relY, w: relW, h };
}

const MIN_VIDEO_REL = 0.04;

export function syncGaugeVideoRectHeight(
  rect: { x: number; y: number; w: number; h: number },
  layout: GaugeLayoutConfig,
  videoW: number,
  videoH: number,
): { x: number; y: number; w: number; h: number } {
  const gr = layout.gaugeRect;
  const frameW = gr.w;
  const frameH = gr.h;
  const maxH = 1 - rect.y;
  const maxW = 1 - rect.x;

  let w = rect.w;
  let h = relativeHeightForFrameAspect(w, frameW, frameH, videoW, videoH);

  if (h > maxH) {
    h = maxH;
    w = relativeWidthForFrameAspect(h, frameW, frameH, videoW, videoH);
  }

  w = clamp(w, MIN_VIDEO_REL, maxW);
  h = relativeHeightForFrameAspect(w, frameW, frameH, videoW, videoH);
  if (h > maxH) {
    h = maxH;
    w = relativeWidthForFrameAspect(h, frameW, frameH, videoW, videoH);
    w = clamp(w, MIN_VIDEO_REL, maxW);
    h = clamp(h, MIN_VIDEO_REL, maxH);
  } else {
    h = clamp(h, MIN_VIDEO_REL, maxH);
  }

  return { ...rect, w, h };
}

const VIDEO_CIRCLE_RESIZE_CORNERS: LayoutCorner[] = ['n', 'e', 's', 'w'];
const VIDEO_RECT_RESIZE_HANDLES: LayoutCorner[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const VIDEO_CIRCLE_HANDLE_DEG: Record<LayoutCorner, number> = {
  n: 180,
  ne: 135,
  e: 90,
  se: 45,
  s: 0,
  sw: 315,
  w: 270,
  nw: 225,
};

export const VIDEO_HANDLE_HIT_PX = 8;

function layoutCornerRelPosition(
  rect: { x: number; y: number; w: number; h: number },
  corner: LayoutCorner,
): XY {
  const { x, y, w, h } = rect;
  if (corner === 'nw') return { x, y };
  if (corner === 'ne') return { x: x + w, y };
  if (corner === 'se') return { x: x + w, y: y + h };
  if (corner === 'sw') return { x, y: y + h };
  if (corner === 'n') return { x: x + w / 2, y };
  if (corner === 's') return { x: x + w / 2, y: y + h };
  if (corner === 'e') return { x: x + w, y: y + h / 2 };
  return { x, y: y + h / 2 };
}

export function videoGaugeResizeHandles(
  _rect: { x: number; y: number; w: number; h: number },
  _isEllipse: boolean,
): LayoutCorner[] {
  return VIDEO_RECT_RESIZE_HANDLES;
}

export function videoGaugeHandleRelPosition(
  rect: { x: number; y: number; w: number; h: number },
  corner: LayoutCorner,
  _isEllipse: boolean,
): XY {
  return layoutCornerRelPosition(rect, corner);
}

export function hitVideoGaugeResizeHandle(
  relX: number,
  relY: number,
  rect: { x: number; y: number; w: number; h: number },
  isEllipse: boolean,
  boxW: number,
  boxH: number,
): LayoutCorner | null {
  const pxX = relX * boxW;
  const pxY = relY * boxH;
  for (const corner of videoGaugeResizeHandles(rect, isEllipse)) {
    const p = videoGaugeHandleRelPosition(rect, corner, isEllipse);
    const dist = Math.hypot(pxX - p.x * boxW, pxY - p.y * boxH);
    if (dist <= VIDEO_HANDLE_HIT_PX) return corner;
  }
  return null;
}

export function videoResizeHandleCursor(corner: LayoutCorner): string {
  if (corner === 'n' || corner === 's') return 'ns-resize';
  if (corner === 'e' || corner === 'w') return 'ew-resize';
  if (corner === 'ne' || corner === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

export function resizeVideoGaugeRect(
  orig: { x: number; y: number; w: number; h: number },
  corner: LayoutCorner,
  dxRel: number,
  dyRel: number,
  layout: GaugeLayoutConfig,
  videoW: number,
  videoH: number,
): { x: number; y: number; w: number; h: number } {
  const gr = layout.gaugeRect;
  const frameW = gr.w;
  const frameH = gr.h;

  let anchorX = orig.x + orig.w / 2;
  if (corner.includes('w')) anchorX = orig.x + orig.w;
  else if (corner.includes('e')) anchorX = orig.x;

  let anchorY = orig.y + orig.h / 2;
  if (corner.includes('n')) anchorY = orig.y + orig.h;
  else if (corner.includes('s')) anchorY = orig.y;

  let newW = orig.w;
  let newH = orig.h;

  if (corner === 'e') newW = orig.w + 2 * dxRel;
  else if (corner === 'w') newW = orig.w - 2 * dxRel;
  else if (corner === 'n') {
    newH = orig.h - 2 * dyRel;
    newW = relativeWidthForFrameAspect(newH, frameW, frameH, videoW, videoH);
  } else if (corner === 's') {
    newH = orig.h + 2 * dyRel;
    newW = relativeWidthForFrameAspect(newH, frameW, frameH, videoW, videoH);
  } else if (corner === 'se' || corner === 'ne') newW = orig.w + dxRel;
  else if (corner === 'nw' || corner === 'sw') newW = orig.w - dxRel;

  if (corner !== 'n' && corner !== 's') {
    const synced = syncGaugeVideoRectHeight(
      { x: 0, y: 0, w: newW, h: orig.h },
      layout,
      videoW,
      videoH,
    );
    newW = synced.w;
    newH = synced.h;
  } else {
    newH = clamp(newH, MIN_VIDEO_REL, 1);
    newW = relativeWidthForFrameAspect(newH, frameW, frameH, videoW, videoH);
    newW = clamp(newW, MIN_VIDEO_REL, 1);
    newH = relativeHeightForFrameAspect(newW, frameW, frameH, videoW, videoH);
    newH = clamp(newH, MIN_VIDEO_REL, 1);
    newW = clamp(newW, MIN_VIDEO_REL, 1);
  }

  let x: number;
  let y: number;
  if (corner.includes('e') && !corner.includes('w')) x = anchorX;
  else if (corner.includes('w')) x = anchorX - newW;
  else x = anchorX - newW / 2;

  if (corner.includes('s') && !corner.includes('n')) y = anchorY;
  else if (corner.includes('n')) y = anchorY - newH;
  else y = anchorY - newH / 2;

  x = clamp(x, 0, 1 - newW);
  y = clamp(y, 0, 1 - newH);

  return syncGaugeVideoRectHeight({ x, y, w: newW, h: newH }, layout, videoW, videoH);
}

export function mergeGaugeLayout(
  partial?: Partial<GaugeLayoutConfig> | null,
  template: GaugeLayoutTemplate = 'telemetry',
): GaugeLayoutConfig {
  const base = template === 'gps'
    ? {
        gaugeRect: { ...DEFAULT_GPS_GAUGE_RECT },
        elements: defaultGaugeElements(DEFAULT_GPS_GAUGE_RECT, 'speed'),
      }
    : DEFAULT_GAUGE_LAYOUT;
  if (!partial) return structuredClone(base);
  const gaugeRect = { ...base.gaugeRect, ...partial.gaugeRect };
  const elements = Array.isArray(partial.elements) && partial.elements.length > 0
    ? structuredClone(partial.elements)
    : structuredClone(base.elements);
  return { gaugeRect, elements: normalizeGaugeElements(elements, gaugeRect) };
}

export function defaultLayoutForTemplate(template: GaugeLayoutTemplate): GaugeLayoutConfig {
  return mergeGaugeLayout(null, template);
}

export type LayoutCorner = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ResizeLayoutOptions {
  minW?: number;
  minH?: number;
  constrainToLayout?: boolean;
}

export function resizeLayoutRect(
  orig: LayoutRect,
  corner: LayoutCorner,
  dx: number,
  dy: number,
  minWOrOptions: number | ResizeLayoutOptions = MIN_RECT_W,
  minH = MIN_RECT_H,
): LayoutRect {
  const options = typeof minWOrOptions === 'object'
    ? minWOrOptions
    : { minW: minWOrOptions, minH, constrainToLayout: true };
  const minW = options.minW ?? MIN_RECT_W;
  const minHResolved = options.minH ?? MIN_RECT_H;
  const cx = orig.x + orig.w / 2;
  const cy = orig.y + orig.h / 2;
  let { x, y, w, h } = orig;

  if (corner === 'n') {
    h = orig.h - 2 * dy;
    y = cy - h / 2;
  } else if (corner === 's') {
    h = orig.h + 2 * dy;
    y = cy - h / 2;
  } else if (corner === 'e') {
    w = orig.w + 2 * dx;
    x = cx - w / 2;
  } else if (corner === 'w') {
    w = orig.w - 2 * dx;
    x = cx - w / 2;
  } else {
    if (corner.includes('e')) w = orig.w + dx;
    if (corner.includes('s')) h = orig.h + dy;
    if (corner.includes('w')) {
      x = orig.x + dx;
      w = orig.w - dx;
    }
    if (corner.includes('n')) {
      y = orig.y + dy;
      h = orig.h - dy;
    }
  }

  if (w < minW) {
    w = minW;
    if (corner === 'e' || corner === 'w') {
      x = cx - w / 2;
    } else if (corner.includes('w')) {
      x = orig.x + (orig.w - minW);
    }
  }
  if (h < minHResolved) {
    h = minHResolved;
    if (corner === 'n' || corner === 's') {
      y = cy - h / 2;
    } else if (corner.includes('n')) {
      y = orig.y + (orig.h - minHResolved);
    }
  }
  if (options.constrainToLayout !== false) {
    if (corner === 'n' || corner === 's' || corner === 'e' || corner === 'w') {
      w = clamp(w, minW, LAYOUT_REF_W);
      h = clamp(h, minHResolved, LAYOUT_REF_H);
      x = clamp(cx - w / 2, 0, LAYOUT_REF_W - w);
      y = clamp(cy - h / 2, 0, LAYOUT_REF_H - h);
    } else {
      x = clamp(x, 0, LAYOUT_REF_W - minW);
      y = clamp(y, 0, LAYOUT_REF_H - minHResolved);
      w = clamp(w, minW, LAYOUT_REF_W - x);
      h = clamp(h, minHResolved, LAYOUT_REF_H - y);
    }
  }
  return { x, y, w, h };
}

export function normalizeSquareGaugeRect(rect: LayoutRect, minSize = MIN_RECT_W): LayoutRect {
  const maxSize = Math.min(LAYOUT_REF_W, LAYOUT_REF_H);
  const size = clamp(Math.max(rect.w, rect.h), minSize, maxSize);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const x = clamp(cx - size / 2, 0, LAYOUT_REF_W - size);
  const y = clamp(cy - size / 2, 0, LAYOUT_REF_H - size);
  return { x, y, w: size, h: size };
}

export function resizeSquareLayoutRect(
  orig: LayoutRect,
  corner: LayoutCorner,
  dx: number,
  dy: number,
  minSizeOrOptions: number | ResizeLayoutOptions = MIN_RECT_W,
): LayoutRect {
  const options = typeof minSizeOrOptions === 'object'
    ? minSizeOrOptions
    : { minW: minSizeOrOptions, constrainToLayout: true };
  const minSize = options.minW ?? MIN_RECT_W;
  const cx = orig.x + orig.w / 2;
  const cy = orig.y + orig.h / 2;
  let size = orig.w;

  if (corner === 'se') size = Math.max(orig.w + dx, orig.h + dy);
  else if (corner === 'nw') size = Math.max(orig.w - dx, orig.h - dy);
  else if (corner === 'ne') size = Math.max(orig.w + dx, orig.h - dy);
  else if (corner === 'sw') size = Math.max(orig.w - dx, orig.h + dy);
  else if (corner === 'e') size = orig.w + 2 * dx;
  else if (corner === 'w') size = orig.w - 2 * dx;
  else if (corner === 's') size = orig.h + 2 * dy;
  else if (corner === 'n') size = orig.h - 2 * dy;

  if (options.constrainToLayout !== false) {
    size = clamp(size, minSize, Math.min(LAYOUT_REF_W, LAYOUT_REF_H));
  } else {
    size = Math.max(size, minSize);
  }

  let x = orig.x;
  let y = orig.y;
  if (corner.includes('w')) x = orig.x + orig.w - size;
  if (corner.includes('n')) y = orig.y + orig.h - size;
  if (corner === 'e' || corner === 'w') y = cy - size / 2;
  if (corner === 'n' || corner === 's') x = cx - size / 2;

  if (options.constrainToLayout !== false) {
    x = clamp(x, 0, LAYOUT_REF_W - size);
    y = clamp(y, 0, LAYOUT_REF_H - size);
  }
  return { x, y, w: size, h: size };
}

export function resolveTextColor(
  choice: TextColorChoice,
  role: TextRole,
  accent: string,
  fallbackLabel = 'rgba(255,255,255,0.45)',
  fallbackUnit = 'rgba(255,255,255,0.65)',
): string {
  if (choice === 'default') {
    if (role === 'value') return accent;
    if (role === 'label') return fallbackLabel;
    return fallbackUnit;
  }
  return choice;
}
