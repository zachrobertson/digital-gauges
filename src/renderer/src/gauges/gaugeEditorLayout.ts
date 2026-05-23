/** Layout types and geometry for the interactive gauge editor (480×270 reference frame). */

export const LAYOUT_REF_W = 480;
export const LAYOUT_REF_H = 270;
export const MIN_RECT_W = 140;
export const MIN_RECT_H = 90;

export interface XY {
  x: number;
  y: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextRole = 'label' | 'value' | 'unit';
export type TextColorChoice = string | 'default';

export interface TextElement {
  visible: boolean;
  /** Absolute coords in the 480×270 reference frame. */
  pos: XY;
  textOverride: string;
  color: TextColorChoice;
  fontSize: number;
}

export interface BarConfig {
  /** Bar track bounds in the 480×270 reference frame (w = length, h = thickness). */
  rect: LayoutRect;
  rounded: boolean;
  /** 'default' follows the live gauge fill color (accent or zone color). */
  color: TextColorChoice;
}

export const MIN_BAR_LENGTH = 20;
export const MIN_BAR_THICKNESS = 4;
export const MIN_MAP_SIZE = 40;

export type GaugeLayoutTemplate = 'telemetry' | 'gps';

export interface GaugeLayoutConfig {
  /** Internal panel bounding box in the 480×270 reference frame. */
  gaugeRect: LayoutRect;
  arcCenter: XY;
  arcRadius: number;
  arcStartDeg: number;
  arcEndDeg: number;
  text: Record<TextRole, TextElement>;
  bar: BarConfig;
  /** Route map bounds in the 480×270 reference frame (GPS gauges). */
  mapRect: LayoutRect;
}

export const TEXT_ROLES: TextRole[] = ['label', 'value', 'unit'];

/** Default panel frame within the 480×270 editor canvas (matches canvas mock v4). */
export const DEFAULT_GAUGE_RECT: LayoutRect = { x: 100, y: 45, w: 280, h: 180 };

const DEFAULT_ARC_CENTER: XY = {
  x: DEFAULT_GAUGE_RECT.x + DEFAULT_GAUGE_RECT.w * 0.5,
  y: DEFAULT_GAUGE_RECT.y + DEFAULT_GAUGE_RECT.h * 0.58,
};

const DEFAULT_ARC_RADIUS = Math.round(
  (Math.min(DEFAULT_GAUGE_RECT.w, DEFAULT_GAUGE_RECT.h) / 2) * 0.65,
);

function defaultTextElement(role: TextRole): TextElement {
  const r = DEFAULT_GAUGE_RECT;
  const cx = r.x + r.w * 0.5;
  const baseline = (yFrac: number) => r.y + r.h * yFrac;
  if (role === 'label') {
    return { visible: true, pos: { x: cx, y: baseline(0.2) }, textOverride: '', color: 'default', fontSize: 11 };
  }
  if (role === 'value') {
    return { visible: true, pos: { x: cx, y: baseline(0.52) }, textOverride: '', color: 'default', fontSize: 36 };
  }
  return { visible: true, pos: { x: cx, y: baseline(0.78) }, textOverride: '', color: 'default', fontSize: 12 };
}

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

export function resolveBarConfig(layout: GaugeLayoutConfig): BarConfig {
  return layout.bar ?? defaultBarConfig(layout.gaugeRect);
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

function defaultGpsTextElement(role: TextRole, gaugeRect: LayoutRect): TextElement {
  const cx = gaugeRect.x + gaugeRect.w * 0.12;
  const top = gaugeRect.y + gaugeRect.h * 0.12;
  if (role === 'label') {
    return { visible: true, pos: { x: cx, y: top }, textOverride: '', color: 'default', fontSize: 11 };
  }
  if (role === 'value') {
    return { visible: false, pos: { x: gaugeRect.x + gaugeRect.w * 0.5, y: gaugeRect.y + gaugeRect.h * 0.5 }, textOverride: '', color: 'default', fontSize: 24 };
  }
  return { visible: false, pos: { x: gaugeRect.x + gaugeRect.w * 0.5, y: gaugeRect.y + gaugeRect.h * 0.72 }, textOverride: '', color: 'default', fontSize: 11 };
}

export const DEFAULT_GPS_GAUGE_RECT: LayoutRect = { x: 90, y: 35, w: 300, h: 200 };

export const DEFAULT_GPS_GAUGE_LAYOUT: GaugeLayoutConfig = (() => {
  const gaugeRect = { ...DEFAULT_GPS_GAUGE_RECT };
  return {
    gaugeRect,
    arcCenter: { x: gaugeRect.x + gaugeRect.w * 0.5, y: gaugeRect.y + gaugeRect.h * 0.58 },
    arcRadius: Math.round((Math.min(gaugeRect.w, gaugeRect.h) / 2) * 0.65),
    arcStartDeg: 30,
    arcEndDeg: 330,
    text: {
      label: defaultGpsTextElement('label', gaugeRect),
      value: defaultGpsTextElement('value', gaugeRect),
      unit: defaultGpsTextElement('unit', gaugeRect),
    },
    bar: defaultBarConfig(gaugeRect),
    mapRect: defaultMapRect(gaugeRect),
  };
})();

export const DEFAULT_GAUGE_LAYOUT: GaugeLayoutConfig = {
  gaugeRect: { ...DEFAULT_GAUGE_RECT },
  arcCenter: { ...DEFAULT_ARC_CENTER },
  arcRadius: DEFAULT_ARC_RADIUS,
  arcStartDeg: 30,
  arcEndDeg: 330,
  text: {
    label: defaultTextElement('label'),
    value: defaultTextElement('value'),
    unit: defaultTextElement('unit'),
  },
  bar: defaultBarConfig(DEFAULT_GAUGE_RECT),
  mapRect: defaultMapRect(DEFAULT_GAUGE_RECT),
};

export const MAX_ARC_RADIUS = Math.min(LAYOUT_REF_W, LAYOUT_REF_H) / 2;

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

export function panelRadius(shape: 'rounded' | 'square' | 'pill' | 'circle', rect: LayoutRect): number {
  if (shape === 'square') return 2;
  if (shape === 'pill' || shape === 'circle') return Math.min(rect.w, rect.h) / 2;
  return 14;
}

export function panelCircleGeometry(rect: LayoutRect): { cx: number; cy: number; r: number } {
  const size = Math.min(rect.w, rect.h);
  const r = size / 2;
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, r };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function snapToGrid(value: number, gridSize: number, enabled: boolean): number {
  if (!enabled || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
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

/** Map layout coords to video pixels — layout frame fills the placement rect. */
export function layoutToVideoPixel(
  local: XY,
  layout: GaugeLayoutConfig,
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
  layout: GaugeLayoutConfig,
  videoRect: { w: number; h: number },
): number {
  const gr = layout.gaugeRect;
  return videoRect.w / gr.w;
}

/** Map layout-frame coords into video pixels via canvas transform (width-based stretch). */
export function withLayoutVideoTransform(
  ctx: CanvasRenderingContext2D,
  layout: GaugeLayoutConfig,
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

export interface LayoutTextDrawOptions {
  accentColor: string;
  fontFamily?: string;
  fontScale?: number;
  roleText: (role: TextRole) => string;
  /** Skip roles whose resolved display string is empty (e.g. GPS map gauges). */
  skipEmpty?: boolean;
}

/** Draw layout text at layout coords — call inside {@link withLayoutVideoTransform}. */
export function drawLayoutTextInLayoutSpace(
  ctx: CanvasRenderingContext2D,
  layout: GaugeLayoutConfig,
  options: LayoutTextDrawOptions,
): void {
  const family = options.fontFamily ?? 'Inter';
  const fontScale = options.fontScale ?? 1;
  for (const role of TEXT_ROLES) {
    const el = layout.text[role];
    if (!el.visible) continue;
    const display = el.textOverride.trim().length > 0 ? el.textOverride : options.roleText(role);
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

/** Layout frame aspect (width / height). */
export function layoutFrameAspect(layout: GaugeLayoutConfig): number {
  const gr = layout.gaugeRect;
  return gr.w / gr.h;
}

/**
 * Relative overlay height so the on-video bounding box matches the layout
 * frame aspect for a given video resolution.
 */
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

/** Inverse of {@link relativeHeightForFrameAspect} — derive width from height. */
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

/** Default relative rect sized to match DEFAULT_GAUGE_LAYOUT frame on a video. */
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

/** Keep on-video gauge size matched to layout frame aspect for the video resolution. */
export function syncGaugeVideoRectHeight(
  rect: { x: number; y: number; w: number; h: number },
  layout: GaugeLayoutConfig,
  videoW: number,
  videoH: number,
  panelShape: 'rounded' | 'square' | 'pill' | 'circle' = 'rounded',
): { x: number; y: number; w: number; h: number } {
  const gr = panelShape === 'circle'
    ? normalizeSquareGaugeRect(layout.gaugeRect)
    : layout.gaugeRect;
  const frameW = gr.w;
  const frameH = panelShape === 'circle' ? gr.w : gr.h;
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
    h = clamp(relativeHeightForFrameAspect(w, frameW, frameH, videoW, videoH), MIN_VIDEO_REL, maxH);
  } else {
    h = clamp(h, MIN_VIDEO_REL, maxH);
  }

  return { ...rect, w, h };
}

export function mergeGaugeLayout(
  partial?: Partial<GaugeLayoutConfig> | null,
  template: GaugeLayoutTemplate = 'telemetry',
): GaugeLayoutConfig {
  const base = template === 'gps' ? DEFAULT_GPS_GAUGE_LAYOUT : DEFAULT_GAUGE_LAYOUT;
  if (!partial) return structuredClone(base);
  const gaugeRect = { ...base.gaugeRect, ...partial.gaugeRect };
  const defaultBar = defaultBarConfig(gaugeRect);
  const defaultMap = defaultMapRect(gaugeRect);
  return {
    gaugeRect,
    arcCenter: { ...base.arcCenter, ...partial.arcCenter },
    arcRadius: partial.arcRadius ?? base.arcRadius,
    arcStartDeg: partial.arcStartDeg ?? base.arcStartDeg,
    arcEndDeg: partial.arcEndDeg ?? base.arcEndDeg,
    text: {
      label: { ...base.text.label, ...partial.text?.label },
      value: { ...base.text.value, ...partial.text?.value },
      unit: { ...base.text.unit, ...partial.text?.unit },
    },
    bar: {
      rect: { ...defaultBar.rect, ...partial.bar?.rect },
      rounded: partial.bar?.rounded ?? defaultBar.rounded,
      color: partial.bar?.color ?? defaultBar.color,
    },
    mapRect: { ...defaultMap, ...partial.mapRect },
  };
}

export function defaultLayoutForTemplate(template: GaugeLayoutTemplate): GaugeLayoutConfig {
  return structuredClone(template === 'gps' ? DEFAULT_GPS_GAUGE_LAYOUT : DEFAULT_GAUGE_LAYOUT);
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
  let { x, y, w, h } = orig;
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
  if (w < minW) {
    if (corner.includes('w')) x = orig.x + (orig.w - minW);
    w = minW;
  }
  if (h < minHResolved) {
    if (corner.includes('n')) y = orig.y + (orig.h - minHResolved);
    h = minHResolved;
  }
  if (options.constrainToLayout !== false) {
    x = clamp(x, 0, LAYOUT_REF_W - minW);
    y = clamp(y, 0, LAYOUT_REF_H - minHResolved);
    w = clamp(w, minW, LAYOUT_REF_W - x);
    h = clamp(h, minHResolved, LAYOUT_REF_H - y);
  }
  return { x, y, w, h };
}

/** Force a layout frame to a centered square (circle bounding box uses side length as diameter). */
export function normalizeSquareGaugeRect(rect: LayoutRect, minSize = MIN_RECT_W): LayoutRect {
  const maxSize = Math.min(LAYOUT_REF_W, LAYOUT_REF_H);
  const size = clamp(Math.max(rect.w, rect.h), minSize, maxSize);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const x = clamp(cx - size / 2, 0, LAYOUT_REF_W - size);
  const y = clamp(cy - size / 2, 0, LAYOUT_REF_H - size);
  return { x, y, w: size, h: size };
}

/** Uniform square resize for circular gauge frames. */
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
  else if (corner === 'e') size = orig.w + dx;
  else if (corner === 'w') size = orig.w - dx;
  else if (corner === 's') size = orig.h + dy;
  else if (corner === 'n') size = orig.h - dy;

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
