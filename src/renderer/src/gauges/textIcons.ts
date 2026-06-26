/**
 * Small vector icons for gauge image elements (e.g. a checkered flag overlay).
 * Drawn on the canvas so they need no asset loading and render identically at export.
 */
import type { TextIcon } from '@shared/types/gaugeElement';

export type { TextIcon };

export const TEXT_ICON_OPTIONS: { value: TextIcon; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'checkeredFlag', label: 'Checkered flag' },
  { value: 'flag', label: 'Flag' },
  { value: 'pin', label: 'Location pin' },
  { value: 'clock', label: 'Clock' },
  { value: 'bolt', label: 'Power bolt' },
  { value: 'heart', label: 'Heart' },
  { value: 'mountain', label: 'Mountain' },
  { value: 'gauge', label: 'Gauge' },
  { value: 'cadence', label: 'Cadence' },
  { value: 'thermo', label: 'Thermometer' },
  { value: 'trophy', label: 'Trophy' },
  { value: 'compass', label: 'Compass' },
  { value: 'bike', label: 'Bike' },
];

/**
 * Stroke icons defined on a 24×24 grid (shared by the canvas renderer and the
 * editor SVG preview so they look identical).
 */
export const VECTOR_ICON_24: Record<string, { paths: string[]; circles?: [number, number, number][] }> = {
  gauge: { paths: ['M4 16a8 8 0 1 1 16 0', 'M12 16l4-4'] },
  cadence: { paths: ['M5 12a7 7 0 0 1 12-5', 'M19 12a7 7 0 0 1-12 5', 'M17 4v3h-3', 'M7 20v-3h3'] },
  thermo: { paths: ['M12 4a2 2 0 0 0-2 2v8a4 4 0 1 0 4 0V6a2 2 0 0 0-2-2Z'] },
  trophy: { paths: ['M7 4h10v4a5 5 0 0 1-10 0V4Z', 'M9 20h6', 'M12 13v7', 'M4 5h3', 'M17 5h3'] },
  compass: { paths: ['M15 9l-2 5-4 1 2-5 4-1Z'], circles: [[12, 12, 8]] },
  bike: { paths: ['M6 17l4-7h5l-3 7', 'M10 10l3-3h2'], circles: [[6, 17, 3], [18, 17, 3]] },
};

/** Icon width for a given height, honoring each icon's aspect ratio. */
export function textIconWidth(kind: TextIcon, height: number): number {
  switch (kind) {
    case 'checkeredFlag': return height * 1.1;
    case 'flag': return height * 0.95;
    case 'pin': return height * 0.72;
    case 'clock': return height;
    case 'bolt': return height * 0.62;
    case 'heart': return height * 1.1;
    case 'mountain': return height * 1.2;
    case 'gauge': return height;
    case 'cadence': return height;
    case 'thermo': return height * 0.6;
    case 'trophy': return height * 0.9;
    case 'compass': return height;
    case 'bike': return height * 1.3;
    default: return 0;
  }
}

/**
 * Draw an icon into the box [x, x+width] × [y-height/2, y+height/2].
 * `color` tints monochrome icons; the checkered flag stays black/white.
 */
export function drawTextIcon(
  ctx: CanvasRenderingContext2D,
  kind: TextIcon,
  x: number,
  y: number,
  height: number,
  color: string,
): void {
  if (kind === 'none') return;
  const w = textIconWidth(kind, height);
  const top = y - height / 2;
  ctx.save();
  switch (kind) {
    case 'checkeredFlag':
      drawCheckeredFlagIcon(ctx, x, top, w, height);
      break;
    case 'flag':
      drawFlagIcon(ctx, x, top, w, height, color);
      break;
    case 'pin':
      drawPinIcon(ctx, x, top, w, height, color);
      break;
    case 'clock':
      drawClockIcon(ctx, x, top, w, height, color);
      break;
    case 'bolt':
      drawBoltIcon(ctx, x, top, w, height, color);
      break;
    case 'heart':
      drawHeartIcon(ctx, x, top, w, height, color);
      break;
    case 'mountain':
      drawMountainIcon(ctx, x, top, w, height, color);
      break;
    case 'gauge':
    case 'cadence':
    case 'thermo':
    case 'trophy':
    case 'compass':
    case 'bike':
      drawVectorIcon(ctx, kind, x, top, w, height, color);
      break;
  }
  ctx.restore();
}

/** Render a shared 24-grid stroke icon by scaling the unit paths into the box. */
function drawVectorIcon(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const def = VECTOR_ICON_24[kind];
  if (!def) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / 24, h / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const d of def.paths) {
    ctx.stroke(new Path2D(d));
  }
  if (def.circles) {
    for (const [cx, cy, r] of def.circles) {
      const p = new Path2D();
      p.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke(p);
    }
  }
  ctx.restore();
}

function drawCheckeredFlagIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // A thin pole on the left, with the checkered cloth occupying the upper portion.
  const poleW = Math.max(1, w * 0.12);
  const flagX = x + poleW;
  const flagW = w - poleW;
  const flagH = h * 0.66;

  // Pole (dark outline + light core so it reads on any background)
  ctx.fillStyle = '#cfcfcf';
  ctx.fillRect(x, y, poleW, h);
  ctx.lineWidth = Math.max(0.5, h * 0.04);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeRect(x, y, poleW, h);

  // Checkered cloth
  const cols = 4;
  const rows = 3;
  const cw = flagW / cols;
  const ch = flagH / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#111111' : '#ffffff';
      ctx.fillRect(flagX + c * cw, y + r * ch, cw + 0.5, ch + 0.5);
    }
  }
  ctx.lineWidth = Math.max(0.6, h * 0.06);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeRect(flagX, y, flagW, flagH);
}

function drawFlagIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const poleW = Math.max(1, h * 0.1);
  ctx.fillStyle = color;
  // Pole
  ctx.fillRect(x, y, poleW, h);
  // Pennant
  ctx.beginPath();
  ctx.moveTo(x + poleW, y);
  ctx.lineTo(x + w, y + h * 0.28);
  ctx.lineTo(x + poleW, y + h * 0.56);
  ctx.closePath();
  ctx.fill();
}

function drawPinIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const cx = x + w / 2;
  const r = w / 2;
  const cy = y + r;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0, false);
  ctx.lineTo(cx, y + h);
  ctx.closePath();
  ctx.fill();
  // Inner hole
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

function drawClockIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2 - Math.max(0.5, h * 0.05);
  ctx.lineWidth = Math.max(1, h * 0.09);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - r * 0.55);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * 0.45, cy);
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawBoltIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.62, y);
  ctx.lineTo(x + w * 0.05, y + h * 0.58);
  ctx.lineTo(x + w * 0.45, y + h * 0.58);
  ctx.lineTo(x + w * 0.38, y + h);
  ctx.lineTo(x + w * 0.95, y + h * 0.42);
  ctx.lineTo(x + w * 0.55, y + h * 0.42);
  ctx.closePath();
  ctx.fill();
}

function drawHeartIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const cx = x + w / 2;
  const topY = y + h * 0.3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, y + h);
  ctx.bezierCurveTo(x - w * 0.05, topY + h * 0.1, x + w * 0.12, y, cx, topY);
  ctx.bezierCurveTo(x + w * 0.88, y, x + w * 1.05, topY + h * 0.1, cx, y + h);
  ctx.closePath();
  ctx.fill();
}

function drawMountainIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + w * 0.36, y + h * 0.18);
  ctx.lineTo(x + w * 0.55, y + h * 0.55);
  ctx.lineTo(x + w * 0.68, y + h * 0.36);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  // Snow cap on the main peak.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.36, y + h * 0.18);
  ctx.lineTo(x + w * 0.28, y + h * 0.36);
  ctx.lineTo(x + w * 0.36, y + h * 0.32);
  ctx.lineTo(x + w * 0.44, y + h * 0.36);
  ctx.closePath();
  ctx.fill();
}
