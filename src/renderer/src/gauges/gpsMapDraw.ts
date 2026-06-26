import type { LayoutRect, XY } from './gaugeEditorLayout';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  latRange: number;
  lonRange: number;
}

export function computeRouteBounds(
  route: LatLon[],
  curLat?: number,
  curLon?: number,
): RouteBounds {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const p of route) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  if (curLat !== undefined && curLon !== undefined) {
    if (curLat < minLat) minLat = curLat;
    if (curLat > maxLat) maxLat = curLat;
    if (curLon < minLon) minLon = curLon;
    if (curLon > maxLon) maxLon = curLon;
  }

  if (!Number.isFinite(minLat)) {
    minLat = curLat ?? 0;
    maxLat = curLat ?? 0;
    minLon = curLon ?? 0;
    maxLon = curLon ?? 0;
  }

  const latPad = Math.max((maxLat - minLat) * 0.05, 0.0001);
  const lonPad = Math.max((maxLon - minLon) * 0.05, 0.0001);
  minLat -= latPad;
  maxLat += latPad;
  minLon -= lonPad;
  maxLon += lonPad;

  return {
    minLat,
    maxLat,
    minLon,
    maxLon,
    latRange: maxLat - minLat,
    lonRange: maxLon - minLon,
  };
}

export function projectLatLonToMapRect(
  lat: number,
  lon: number,
  bounds: RouteBounds,
  mapRect: LayoutRect,
): XY {
  const scaleX = mapRect.w / Math.max(1e-9, bounds.lonRange);
  const scaleY = mapRect.h / Math.max(1e-9, bounds.latRange);
  const s = Math.min(scaleX, scaleY);
  const offX = (mapRect.w - bounds.lonRange * s) / 2;
  const offY = (mapRect.h - bounds.latRange * s) / 2;
  return {
    x: mapRect.x + offX + (lon - bounds.minLon) * s,
    y: mapRect.y + offY + (bounds.maxLat - lat) * s,
  };
}

export function projectRouteToMapRect(
  route: LatLon[],
  mapRect: LayoutRect,
  curLat?: number,
  curLon?: number,
): { trail: XY[]; cursor: XY | null } {
  const bounds = computeRouteBounds(route, curLat, curLon);
  const trail = route.map((p) => projectLatLonToMapRect(p.lat, p.lon, bounds, mapRect));
  const cursor = curLat !== undefined && curLon !== undefined
    ? projectLatLonToMapRect(curLat, curLon, bounds, mapRect)
    : null;
  return { trail, cursor };
}

/** Sample winding route for the sidebar editor when no GPS track is loaded. */
export const SAMPLE_EDITOR_ROUTE: LatLon[] = [
  { lat: 0.0022, lon: -0.0018 },
  { lat: 0.0015, lon: -0.0008 },
  { lat: 0.0004, lon: 0.0002 },
  { lat: -0.0008, lon: 0.0012 },
  { lat: -0.0016, lon: 0.0024 },
  { lat: -0.0022, lon: 0.0016 },
  { lat: -0.0028, lon: 0.0004 },
  { lat: -0.0020, lon: -0.0006 },
  { lat: -0.0010, lon: -0.0016 },
  { lat: 0.0002, lon: -0.0022 },
];

export function sampleRouteCursor(route: LatLon[], ratio: number): LatLon {
  if (route.length === 0) return { lat: 0, lon: 0 };
  if (route.length === 1) return route[0];
  const clamped = Math.max(0, Math.min(1, ratio));
  const idx = clamped * (route.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(route.length - 1, lo + 1);
  const t = idx - lo;
  return {
    lat: route[lo].lat + (route[hi].lat - route[lo].lat) * t,
    lon: route[lo].lon + (route[hi].lon - route[lo].lon) * t,
  };
}

import type { MarkerStyle } from '@shared/types/gaugeElement';

export type { MarkerStyle };

export const DEFAULT_START_MARKER_COLOR = '#22c55e';
export const DEFAULT_FINISH_MARKER_COLOR = '#111111';
/**
 * Default marker dimensions in layout reference pixels (480×270 design space,
 * the same units as the editor's other "px" controls).
 * `length` = primary/long axis, `width` = secondary/short axis.
 */
export const DEFAULT_MARKER_LENGTH = 56;
export const DEFAULT_MARKER_WIDTH = 30;

export interface CourseMarkerOverlay {
  start?: LatLon | null;
  finish?: LatLon | null;
  showStart?: boolean;
  showFinish?: boolean;
  startStyle?: MarkerStyle;
  finishStyle?: MarkerStyle;
  startColor?: string;
  finishColor?: string;
  /** Marker primary/long axis in layout pixels. */
  length?: number;
  /** Marker secondary/short axis in layout pixels. */
  width?: number;
}

/**
 * Build the marker overlay from a gauge config, resolving the separate
 * start/finish toggles (with back-compat for the old `showCourseMarkers` flag
 * and the old `markerScale` multiplier).
 */
export function resolveCourseMarkerOverlay(
  config: Record<string, unknown>,
  start: LatLon | null | undefined,
  finish: LatLon | null | undefined,
): CourseMarkerOverlay {
  const legacy = config.showCourseMarkers as boolean | undefined;
  const legacyScale = typeof config.markerScale === 'number' ? config.markerScale : 1;
  const normalizeStyle = (style: unknown): MarkerStyle => (style === 'line' ? 'line' : 'flag');
  return {
    start: start ?? null,
    finish: finish ?? null,
    showStart: (config.showCourseStart as boolean | undefined) ?? legacy ?? true,
    showFinish: (config.showCourseFinish as boolean | undefined) ?? legacy ?? true,
    startStyle: normalizeStyle(config.startMarkerStyle),
    finishStyle: normalizeStyle(config.finishMarkerStyle),
    startColor: (config.startMarkerColor as string | undefined) ?? DEFAULT_START_MARKER_COLOR,
    finishColor: (config.finishMarkerColor as string | undefined) ?? DEFAULT_FINISH_MARKER_COLOR,
    length: typeof config.markerLength === 'number' ? config.markerLength : DEFAULT_MARKER_LENGTH * legacyScale,
    width: typeof config.markerWidth === 'number' ? config.markerWidth : DEFAULT_MARKER_WIDTH * legacyScale,
  };
}

export function drawGpsMapOnCanvas(
  ctx: CanvasRenderingContext2D,
  mapRect: { x: number; y: number; w: number; h: number },
  route: LatLon[],
  curLat: number | undefined,
  curLon: number | undefined,
  trailColor: string,
  cursorColor: string,
  sizeScale: number,
  markers?: CourseMarkerOverlay,
): void {
  const bounds = computeRouteBounds(route, curLat, curLon);
  const trail = route.map((p) => projectLatLonToMapRect(p.lat, p.lon, bounds, mapRect));
  const cursor = curLat !== undefined && curLon !== undefined
    ? projectLatLonToMapRect(curLat, curLon, bounds, mapRect)
    : null;

  if (trail.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i < trail.length; i++) {
      ctx.lineTo(trail[i].x, trail[i].y);
    }
    ctx.strokeStyle = trailColor;
    ctx.lineWidth = Math.max(1.5, sizeScale * 0.012);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  const markerLength = markers?.length ?? DEFAULT_MARKER_LENGTH;
  const markerWidth = markers?.width ?? DEFAULT_MARKER_WIDTH;

  if (markers?.start && markers.showStart !== false) {
    const p = projectLatLonToMapRect(markers.start.lat, markers.start.lon, bounds, mapRect);
    drawCourseMarker(
      ctx,
      p,
      trail,
      markerLength,
      markerWidth,
      markers.startStyle ?? 'flag',
      markers.startColor ?? DEFAULT_START_MARKER_COLOR,
    );
  }
  if (markers?.finish && markers.showFinish !== false) {
    const p = projectLatLonToMapRect(markers.finish.lat, markers.finish.lon, bounds, mapRect);
    drawCourseMarker(
      ctx,
      p,
      trail,
      markerLength,
      markerWidth,
      markers.finishStyle ?? 'flag',
      markers.finishColor ?? DEFAULT_FINISH_MARKER_COLOR,
    );
  }

  if (cursor) {
    const r = Math.max(3, sizeScale * 0.04);
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
    ctx.fillStyle = cursorColor;
    ctx.fill();
    ctx.lineWidth = Math.max(1, sizeScale * 0.01);
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }
}

/**
 * Draw a course start/finish marker in the requested style.
 * `lengthPx` is the primary/long axis, `widthPx` the secondary/short axis
 * (in layout reference pixels).
 */
export function drawCourseMarker(
  ctx: CanvasRenderingContext2D,
  point: XY,
  trail: XY[],
  lengthPx: number,
  widthPx: number,
  style: MarkerStyle,
  color: string,
): void {
  if (style === 'line') {
    drawCheckerLine(ctx, point, nearestTrailAngle(trail, point), lengthPx, widthPx, color);
  } else {
    drawCourseFlag(ctx, point, lengthPx, widthPx, color);
  }
}

/**
 * Draw a checkered flag marker, tinted with `color`.
 * `lengthPx` is the total height (pole + flag); `widthPx` is the flag width.
 */
export function drawCourseFlag(
  ctx: CanvasRenderingContext2D,
  point: XY,
  lengthPx: number,
  widthPx: number,
  color: string,
): void {
  const flagW = Math.max(4, widthPx);
  const flagH = Math.max(3, widthPx * 0.62);
  const totalH = Math.max(flagH + 4, lengthPx);
  const baseX = point.x;
  const baseY = point.y;
  const topY = baseY - totalH;
  const detail = Math.min(lengthPx, widthPx);
  const dotR = Math.max(1.5, detail * 0.09);
  const lineW = Math.max(1, detail * 0.05);
  const colorA = color;
  const colorB = '#ffffff';
  const cols = 3;
  const rows = 2;
  const cw = flagW / cols;
  const ch = flagH / rows;

  ctx.save();

  // Pole
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(baseX, topY);
  ctx.lineWidth = lineW * 1.6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(baseX, topY);
  ctx.lineWidth = lineW;
  ctx.strokeStyle = '#f5f5f5';
  ctx.stroke();

  // Checkered flag
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? colorA : colorB;
      ctx.fillRect(baseX + c * cw, topY + r * ch, cw + 0.5, ch + 0.5);
    }
  }
  ctx.lineWidth = lineW;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeRect(baseX, topY, flagW, flagH);

  // Base dot at the exact track position
  ctx.beginPath();
  ctx.arc(baseX, baseY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = colorA;
  ctx.fill();
  ctx.lineWidth = lineW;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.restore();
}

/** Direction (radians) of the trail at the point closest to `point`. */
export function nearestTrailAngle(trail: XY[], point: XY): number {
  if (trail.length < 2) return 0;
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < trail.length - 1; i++) {
    const mx = (trail[i].x + trail[i + 1].x) / 2;
    const my = (trail[i].y + trail[i + 1].y) / 2;
    const d = (mx - point.x) ** 2 + (my - point.y) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return Math.atan2(trail[bestI + 1].y - trail[bestI].y, trail[bestI + 1].x - trail[bestI].x);
}

/**
 * Checkered finish line drawn as a strip laid across the route (perpendicular to travel).
 * `lengthPx` is the span across the route; `widthPx` is the thickness along the route.
 */
export function drawCheckerLine(
  ctx: CanvasRenderingContext2D,
  point: XY,
  trailAngle: number,
  lengthPx: number,
  widthPx: number,
  color: string,
): void {
  const len = Math.max(6, lengthPx); // span across the route
  const thickness = Math.max(3, widthPx); // depth along the route
  const cols = 6;
  const rows = 2;
  const cw = len / cols;
  const ch = thickness / rows;

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(trailAngle + Math.PI / 2); // local x-axis now lies across the route

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? color : '#ffffff';
      ctx.fillRect(-len / 2 + c * cw, -thickness / 2 + r * ch, cw + 0.5, ch + 0.5);
    }
  }
  ctx.lineWidth = Math.max(0.8, Math.min(len, thickness) * 0.04);
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeRect(-len / 2, -thickness / 2, len, thickness);
  ctx.restore();
}
