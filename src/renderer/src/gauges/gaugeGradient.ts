/** Gradual multi-stop fill gradient for bar/arc gauges (0 = min, 1 = max). */

export interface FillGradientStop {
  pos: number;
  color: string;
}

export interface FillGradientConfig {
  enabled: boolean;
  stops: FillGradientStop[];
}

export const HR_GRADIENT_PRESET: FillGradientConfig = {
  enabled: true,
  stops: [
    { pos: 0, color: '#3b82f6' },
    { pos: 0.35, color: '#10b981' },
    { pos: 0.65, color: '#eab308' },
    { pos: 1, color: '#ef4444' },
  ],
};

export const POWER_GRADIENT_PRESET: FillGradientConfig = {
  enabled: true,
  stops: [
    { pos: 0, color: '#6b7280' },
    { pos: 0.35, color: '#3b82f6' },
    { pos: 0.55, color: '#10b981' },
    { pos: 0.72, color: '#f59e0b' },
    { pos: 0.88, color: '#ef4444' },
    { pos: 1, color: '#a855f7' },
  ],
};

export const SPEED_GRADIENT_PRESET: FillGradientConfig = {
  enabled: true,
  stops: [
    { pos: 0, color: '#3b82f6' },
    { pos: 0.5, color: '#3ddc97' },
    { pos: 0.8, color: '#eab308' },
    { pos: 1, color: '#ef4444' },
  ],
};

type Rgba = [number, number, number, number];

function parseHexColor(hex: string): Rgba | null {
  const c = hex.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    return [
      parseInt(c.slice(1, 3), 16),
      parseInt(c.slice(3, 5), 16),
      parseInt(c.slice(5, 7), 16),
      1,
    ];
  }
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    const r = c[1];
    const g = c[2];
    const b = c[3];
    return [
      parseInt(`${r}${r}`, 16),
      parseInt(`${g}${g}`, 16),
      parseInt(`${b}${b}`, 16),
      1,
    ];
  }
  return null;
}

function parseColor(color: string): Rgba {
  const hex = parseHexColor(color);
  if (hex) return hex;
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] != null ? Number(rgb[4]) : 1,
    ];
  }
  return [109, 120, 134, 1];
}

function rgbaToCss([r, g, b, a]: Rgba): string {
  if (a >= 0.999) {
    const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3).replace(/\.?0+$/, '')})`;
}

function lerpRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

export function normalizeGradientStops(stops: FillGradientStop[]): FillGradientStop[] {
  if (!stops.length) {
    return [
      { pos: 0, color: '#3b82f6' },
      { pos: 1, color: '#ef4444' },
    ];
  }
  const sorted = [...stops]
    .map((s) => ({ pos: Math.max(0, Math.min(1, s.pos)), color: s.color }))
    .sort((a, b) => a.pos - b.pos);
  if (sorted[0].pos > 0) sorted.unshift({ pos: 0, color: sorted[0].color });
  if (sorted[sorted.length - 1].pos < 1) {
    sorted.push({ pos: 1, color: sorted[sorted.length - 1].color });
  }
  return sorted;
}

export function mergeFillGradient(partial?: FillGradientConfig | null): FillGradientConfig {
  if (!partial) return { enabled: false, stops: normalizeGradientStops([]) };
  return {
    enabled: partial.enabled ?? false,
    stops: normalizeGradientStops(partial.stops ?? []),
  };
}

export function colorAtGradient(stops: FillGradientStop[], t: number): string {
  const norm = normalizeGradientStops(stops);
  const x = Math.max(0, Math.min(1, t));
  if (x <= norm[0].pos) return norm[0].color;
  if (x >= norm[norm.length - 1].pos) return norm[norm.length - 1].color;
  for (let i = 0; i < norm.length - 1; i++) {
    const a = norm[i];
    const b = norm[i + 1];
    if (x >= a.pos && x <= b.pos) {
      const span = b.pos - a.pos || 1;
      const local = (x - a.pos) / span;
      return rgbaToCss(lerpRgba(parseColor(a.color), parseColor(b.color), local));
    }
  }
  return norm[norm.length - 1].color;
}

export function resolveFillGradient(config: {
  fillGradient?: FillGradientConfig | null;
}): FillGradientConfig {
  return mergeFillGradient(config.fillGradient);
}

export function fillColorForRatio(
  gradient: FillGradientConfig | undefined,
  ratio: number,
  solidColor: string,
): string {
  if (gradient?.enabled && gradient.stops.length >= 2) {
    return colorAtGradient(gradient.stops, ratio);
  }
  return solidColor;
}

function clampRatio(ratio: number): number {
  return Math.max(0, Math.min(1, ratio));
}

export function addStopsToLinearGradient(
  grad: CanvasGradient,
  stops: FillGradientStop[],
): void {
  for (const stop of normalizeGradientStops(stops)) {
    grad.addColorStop(stop.pos, stop.color);
  }
}

/** Fill a horizontal bar track with a left-to-right gradient, clipped to the current value ratio. */
export function fillBarWithGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  stops: FillGradientStop[],
  rounded: boolean,
  roundRectPath: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => void,
): void {
  if (w <= 0 || h <= 0) return;
  const fillW = Math.max(1, w * clampRatio(ratio));
  ctx.save();
  if (rounded) {
    roundRectPath(ctx, x, y, fillW, h, h / 2);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(x, y, fillW, h);
    ctx.clip();
  }
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  addStopsToLinearGradient(grad, stops);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Build a short arc path from startDeg to endDeg (same coordinate space as the full dial track). */
export type ArcSegmentPathFn = (startDeg: number, endDeg: number) => Path2D;

/** Stroke an arc dial in small segments, each colored by its position on the gradient scale. */
export function strokeArcWithGradientSegments(
  ctx: CanvasRenderingContext2D,
  startDeg: number,
  endDeg: number,
  ratio: number,
  trackW: number,
  stops: FillGradientStop[],
  buildSegmentPath: ArcSegmentPathFn,
): void {
  const maxT = clampRatio(ratio);
  if (maxT <= 0.002) return;
  const sweep = ((endDeg - startDeg) + 360) % 360;
  const steps = Math.max(24, Math.ceil(sweep / 3));
  ctx.save();
  ctx.lineWidth = trackW;
  for (let i = 0; i < steps; i++) {
    const t0 = (i / steps) * maxT;
    const t1 = Math.min(((i + 1) / steps) * maxT, maxT);
    if (t0 >= maxT) break;
    const deg0 = startDeg + sweep * t0;
    const deg1 = startDeg + sweep * t1;
    const isFirst = i === 0;
    const isLast = t1 >= maxT - 1e-9;
    ctx.lineCap = isFirst || isLast ? 'round' : 'butt';
    ctx.strokeStyle = colorAtGradient(stops, (t0 + t1) / 2);
    ctx.stroke(buildSegmentPath(deg0, deg1));
  }
  ctx.restore();
}

/** Legacy canvas arc API using dial degrees (not radians). */
export function strokeCanvasArcWithGradientDegrees(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  ratio: number,
  trackW: number,
  stops: FillGradientStop[],
  toCanvasRad: (deg: number) => number,
  counterclockwise: boolean,
): void {
  strokeArcWithGradientSegments(
    ctx,
    startDeg,
    endDeg,
    ratio,
    trackW,
    stops,
    (deg0, deg1) => {
      const path = new Path2D();
      path.arc(cx, cy, r, toCanvasRad(deg0), toCanvasRad(deg1), counterclockwise);
      return path;
    },
  );
}
