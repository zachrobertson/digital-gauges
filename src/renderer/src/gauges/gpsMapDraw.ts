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

export function drawGpsMapOnCanvas(
  ctx: CanvasRenderingContext2D,
  mapRect: { x: number; y: number; w: number; h: number },
  route: LatLon[],
  curLat: number | undefined,
  curLon: number | undefined,
  trailColor: string,
  cursorColor: string,
  sizeScale: number,
): void {
  const { trail, cursor } = projectRouteToMapRect(route, mapRect, curLat, curLon);

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
