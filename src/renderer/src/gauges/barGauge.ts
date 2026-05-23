import type { PanelStyle } from './common';
import { clamp, drawBigNumber, drawLabel, fillPanel, roundRect, unitFont, withGaugeBoundsClip } from './common';
import type { BarGaugeDisplayStyle, BarGaugeTextLayout } from './barGaugeSchema';
import { resolveArcTickCount } from './barGaugeSchema';
import type { GaugeLayoutConfig, TextRole } from './gaugeEditorLayout';
import {
  arcGeometry,
  arcPath,
  dialPoint as layoutDialPoint,
  drawLayoutTextInLayoutSpace,
  mergeGaugeLayout,
  resolveBarConfig,
  resolveBarFillColor,
  withLayoutVideoTransform,
} from './gaugeEditorLayout';
import type { FillGradientConfig } from './gaugeGradient';
import {
  fillBarWithGradient,
  resolveFillGradient,
  strokeArcWithGradientSegments,
  strokeCanvasArcWithGradientDegrees,
} from './gaugeGradient';

export interface BarGaugeRenderInput {
  ctx: CanvasRenderingContext2D;
  rect: { x: number; y: number; w: number; h: number };
  panelStyle: PanelStyle;
  label: string;
  valueText: string;
  unitText: string;
  ratio: number;
  color: string;
  displayStyle?: BarGaugeDisplayStyle;
  textLayout?: BarGaugeTextLayout;
  layout?: GaugeLayoutConfig;
  showLabel?: boolean;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  showScaleLabels?: boolean;
  showArcTicks?: boolean;
  arcTickCount?: number;
  fillGradient?: FillGradientConfig;
}

export function resolveDisplayStyle(v?: BarGaugeDisplayStyle): BarGaugeDisplayStyle {
  if (v === 'arc' || v === 'text') return v;
  return 'bar';
}

/** Shared renderer for speed / power / HR / cadence gauges (bar, arc, or text). */
export function renderBarGauge(input: BarGaugeRenderInput): void {
  withGaugeBoundsClip(input.ctx, input.rect, () => {
    const style = resolveDisplayStyle(input.displayStyle);
    const layout = mergeGaugeLayout(input.layout);
    withLayoutVideoTransform(input.ctx, layout, input.rect, () => {
      if (style === 'text') {
        renderCustomTextGauge(input, layout);
      } else if (style === 'arc') {
        renderCustomArcGauge(input, layout);
      } else {
        renderCustomBarGauge(input, layout);
      }
    });
  });
}

function renderCustomTextGauge(input: BarGaugeRenderInput, layout: GaugeLayoutConfig): void {
  const { ctx, panelStyle } = input;
  fillPanel(ctx, layout.gaugeRect, panelStyle);
  drawBarLayoutText(ctx, input, layout);
}

function roleText(role: TextRole, input: BarGaugeRenderInput): string {
  if (role === 'label') return input.label.toUpperCase();
  if (role === 'unit') return input.unitText;
  return input.valueText;
}

function drawBarLayoutText(
  ctx: CanvasRenderingContext2D,
  input: BarGaugeRenderInput,
  layout: GaugeLayoutConfig,
): void {
  drawLayoutTextInLayoutSpace(ctx, layout, {
    accentColor: input.color,
    fontFamily: input.panelStyle.fontFamily,
    fontScale: input.panelStyle.fontScale,
    roleText: (role) => roleText(role, input),
  });
}

function activeFillGradient(input: BarGaugeRenderInput): FillGradientConfig | null {
  const gradient = resolveFillGradient({ fillGradient: input.fillGradient });
  if (!gradient.enabled || gradient.stops.length < 2) return null;
  return gradient;
}

function majorArcTickInterval(tickCount: number): number {
  return Math.max(1, Math.round(tickCount / 2));
}

function drawArcHashMarks(
  ctx: CanvasRenderingContext2D,
  startDeg: number,
  sweep: number,
  tickCount: number,
  atDeg: (deg: number) => { inner: { x: number; y: number }; outer: { x: number; y: number } },
  majorLineWidth = 1.4,
  minorLineWidth = 0.8,
): void {
  const count = resolveArcTickCount({ arcTickCount: tickCount });
  const majorEvery = majorArcTickInterval(count);
  for (let i = 0; i <= count; i++) {
    const td = startDeg + (sweep * i) / count;
    const { inner, outer } = atDeg(td);
    const major = i % majorEvery === 0;
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.strokeStyle = major ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = major ? majorLineWidth : minorLineWidth;
    ctx.stroke();
  }
}

function fillBarRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rounded: boolean,
): void {
  if (rounded && w > 0 && h > 0) {
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    return;
  }
  ctx.fillRect(x, y, w, h);
}

function renderCustomBarGauge(input: BarGaugeRenderInput, layout: GaugeLayoutConfig): void {
  const { ctx, ratio, color, panelStyle } = input;
  fillPanel(ctx, layout.gaugeRect, panelStyle);

  const bar = resolveBarConfig(layout);
  const track = bar.rect;
  const fillW = Math.max(1, track.w * clamp(ratio, 0, 1));
  const barFill = resolveBarFillColor(bar, color);
  const gradient = activeFillGradient(input);
  const useBarGradient = gradient != null && bar.color === 'default';

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  fillBarRect(ctx, track.x, track.y, track.w, track.h, bar.rounded);
  if (useBarGradient) {
    fillBarWithGradient(
      ctx, track.x, track.y, track.w, track.h, ratio, gradient.stops, bar.rounded, roundRect,
    );
  } else {
    ctx.fillStyle = barFill;
    fillBarRect(ctx, track.x, track.y, fillW, track.h, bar.rounded);
  }
  drawBarLayoutText(ctx, input, layout);
}

function renderCustomArcGauge(input: BarGaugeRenderInput, layout: GaugeLayoutConfig): void {
  const {
    ctx, panelStyle, ratio, color,
    scaleMinLabel = '0', scaleMaxLabel = 'MAX',
  } = input;
  fillPanel(ctx, layout.gaugeRect, panelStyle);
  const family = panelStyle.fontFamily ?? 'Inter';
  const fontScale = panelStyle.fontScale ?? 1;
  const clamped = clamp(ratio, 0, 1);

  const { cx, cy, r } = arcGeometry(layout.arcCenter, layout.arcRadius);
  const localTrackW = Math.max(6, r * 0.16);
  const sweep = ((layout.arcEndDeg - layout.arcStartDeg) + 360) % 360;
  const valueDeg = (layout.arcStartDeg + sweep * clamped) % 360;

  ctx.save();
  const track = new Path2D(arcPath(cx, cy, r, layout.arcStartDeg, layout.arcEndDeg));
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = localTrackW;
  ctx.lineCap = 'round';
  ctx.stroke(track);

  if (clamped > 0.002) {
    const gradient = activeFillGradient(input);
    if (gradient) {
      strokeArcWithGradientSegments(
        ctx,
        layout.arcStartDeg,
        layout.arcEndDeg,
        clamped,
        localTrackW,
        gradient.stops,
        (deg0, deg1) => new Path2D(arcPath(cx, cy, r, deg0, deg1)),
      );
    } else {
      const valueTrack = new Path2D(arcPath(cx, cy, r, layout.arcStartDeg, valueDeg));
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.stroke(valueTrack);
    }
  }

  if (input.showArcTicks !== false) {
    drawArcHashMarks(
      ctx,
      layout.arcStartDeg,
      sweep,
      input.arcTickCount ?? 8,
      (td) => {
        const inner = layoutDialPoint(cx, cy, r - localTrackW * 0.8, td);
        const outer = layoutDialPoint(cx, cy, r + localTrackW * 0.55, td);
        return { inner, outer };
      },
    );
  }

  const labelR = Math.max(8, r - localTrackW * 1.6);
  if (input.showScaleLabels) {
    const scaleSize = Math.max(7, 9 * fontScale);
    ctx.font = `600 ${Math.floor(scaleSize)}px ${family}, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const minPt = layoutDialPoint(cx, cy, labelR, layout.arcStartDeg);
    const maxPt = layoutDialPoint(cx, cy, labelR, layout.arcEndDeg);
    ctx.fillText(scaleMinLabel, minPt.x, minPt.y);
    ctx.fillText(scaleMaxLabel, maxPt.x, maxPt.y);
  }
  ctx.restore();

  drawBarLayoutText(ctx, input, layout);
}

function renderHorizontalBarGauge(input: BarGaugeRenderInput): void {
  const {
    ctx, rect, panelStyle, label, valueText, unitText, ratio, color,
  } = input;
  const layout = input.textLayout ?? 'standard';
  const showLabel = input.showLabel !== false && layout !== 'minimal';

  const pad = rect.h * 0.14;
  const barH = rect.h * 0.08;
  const barY = rect.y + rect.h - pad - barH;
  const textBottom = barY - pad * 0.35;
  const cx = rect.x + rect.w / 2;
  const scale = panelStyle.fontScale ?? 1;
  const family = panelStyle.fontFamily ?? 'Inter';

  const valueSize = rect.h * 0.46 * scale;
  const labelSize = rect.h * 0.12 * scale;
  const unitSize = rect.h * 0.16 * scale;

  if (layout === 'standard') {
    if (showLabel) {
      drawLabel(ctx, label, rect.x + pad, rect.y + pad, rect.h * 0.13, undefined, panelStyle);
    }
    drawBigNumber(
      ctx, valueText,
      rect.x + pad,
      rect.y + rect.h * 0.46,
      valueSize, color, panelStyle,
    );
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = unitFont(rect.h, panelStyle);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(unitText, rect.x + rect.w - pad - ctx.measureText(unitText).width, rect.y + rect.h * 0.46);
  } else if (layout === 'centered') {
    if (showLabel) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `500 ${Math.floor(labelSize)}px ${family}, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label.toUpperCase(), cx, rect.y + pad + labelSize);
    }
    ctx.textAlign = 'center';
    drawBigNumber(ctx, valueText, cx, textBottom - unitSize * 0.6, valueSize, color, panelStyle);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `500 ${Math.floor(unitSize)}px ${family}, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(unitText, cx, textBottom - unitSize * 0.2);
  } else if (layout === 'stacked') {
    const blockH = labelSize + valueSize + unitSize + pad * 0.4;
    let y = textBottom - blockH;
    if (showLabel) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `500 ${Math.floor(labelSize)}px ${family}, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label.toUpperCase(), cx, y);
      y += labelSize + pad * 0.15;
    }
    ctx.textAlign = 'center';
    drawBigNumber(ctx, valueText, cx, y + valueSize * 0.45, valueSize, color, panelStyle);
    y += valueSize * 0.85;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `500 ${Math.floor(unitSize)}px ${family}, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(unitText, cx, y);
  } else {
    ctx.textAlign = 'center';
    drawBigNumber(ctx, valueText, cx, textBottom - valueSize * 0.35, valueSize, color, panelStyle);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `500 ${Math.floor(unitSize)}px ${family}, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(unitText, cx, textBottom - unitSize * 0.15);
  }

  ctx.textAlign = 'left';

  const barX = rect.x + pad;
  const barW = rect.w - pad * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(barX, barY, barW, barH);
  const gradient = activeFillGradient(input);
  if (gradient) {
    fillBarWithGradient(ctx, barX, barY, barW, barH, ratio, gradient.stops, false, roundRect);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(barX, barY, barW * clamp(ratio, 0, 1), barH);
  }
}

/** Dial degrees: 0 = bottom, increases clockwise. */
const ARC_START_DEG = 30;
const ARC_END_DEG = 330;
const ARC_SWEEP_DEG = ARC_END_DEG - ARC_START_DEG;

function dialDegToCanvasRad(deg: number): number {
  return Math.PI / 2 - (deg * Math.PI) / 180;
}

function dialPoint(
  cx: number,
  cy: number,
  r: number,
  userDeg: number,
): { x: number; y: number } {
  const rad = (userDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.sin(rad),
    y: cy + r * Math.cos(rad),
  };
}

/** Car-style speedometer — arc fills clockwise from 30° to 330° (0° = bottom). */
function renderArcGauge(input: BarGaugeRenderInput): void {
  const {
    ctx, rect, panelStyle, label, valueText, unitText, ratio, color,
    scaleMinLabel = '0', scaleMaxLabel = 'MAX',
  } = input;
  const pad = Math.max(6, rect.w * 0.05);
  const scale = panelStyle.fontScale ?? 1;
  const family = panelStyle.fontFamily ?? 'Inter';
  const clamped = clamp(ratio, 0, 1);

  const innerTop = rect.y + pad;
  const innerBottom = rect.y + rect.h - pad;
  const innerH = innerBottom - innerTop;
  const cx = rect.x + rect.w / 2;

  const radius = Math.min((rect.w - pad * 2) * 0.44, (innerH - pad) / 2.05);
  const cy = innerBottom - radius - pad * 0.2;
  const trackW = Math.max(7, radius * 0.13);

  const startAngle = dialDegToCanvasRad(ARC_START_DEG);
  const endAngle = dialDegToCanvasRad(ARC_END_DEG);
  const valueUserDeg = ARC_START_DEG + ARC_SWEEP_DEG * clamped;
  const valueAngle = dialDegToCanvasRad(valueUserDeg);

  ctx.save();
  roundRect(ctx, rect.x + pad * 0.4, innerTop, rect.w - pad * 0.8, innerH, Math.min(innerH * 0.1, 12));
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(rect.x, innerTop, rect.w, innerH);

  // Background track (long arc clockwise from 30° → 330° over the top)
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle, true);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = trackW;
  ctx.lineCap = 'round';
  ctx.stroke();

  if (clamped > 0.002) {
    const gradient = activeFillGradient(input);
    if (gradient) {
      strokeCanvasArcWithGradientDegrees(
        ctx,
        cx,
        cy,
        radius,
        ARC_START_DEG,
        ARC_END_DEG,
        clamped,
        trackW,
        gradient.stops,
        dialDegToCanvasRad,
        true,
      );
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, valueAngle, true);
      ctx.strokeStyle = color;
      ctx.lineWidth = trackW;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  if (input.showArcTicks !== false) {
    drawArcHashMarks(
      ctx,
      ARC_START_DEG,
      ARC_SWEEP_DEG,
      input.arcTickCount ?? 8,
      (userDeg) => ({
        inner: dialPoint(cx, cy, radius - trackW * 0.65, userDeg),
        outer: dialPoint(cx, cy, radius + trackW * 0.45, userDeg),
      }),
      1.5,
      1,
    );
  }

  const scaleSize = Math.max(7, radius * 0.11 * scale);
  if (input.showScaleLabels) {
    ctx.font = `600 ${Math.floor(scaleSize)}px ${family}, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const minPt = dialPoint(cx, cy, radius + trackW * 0.95, ARC_START_DEG);
    const maxPt = dialPoint(cx, cy, radius + trackW * 0.95, ARC_END_DEG);
    ctx.fillText(scaleMinLabel, minPt.x, minPt.y);
    ctx.fillText(scaleMaxLabel, maxPt.x, maxPt.y);
  }

  // Text in the bottom gap (0° = bottom center, inside the dial)
  const gap = dialPoint(cx, cy, radius * 0.48, 0);
  const labelSize = Math.max(7, radius * 0.11 * scale);
  const valueSize = Math.max(12, radius * 0.32 * scale);
  const unitSize = Math.max(7, radius * 0.12 * scale);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `500 ${Math.floor(labelSize)}px ${family}, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label.toUpperCase(), gap.x, gap.y - valueSize * 0.38);

  ctx.textAlign = 'center';
  drawBigNumber(ctx, valueText, gap.x, gap.y + valueSize * 0.05, valueSize, '#ffffff', panelStyle);

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `600 ${Math.floor(unitSize)}px ${family}, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(unitText, gap.x, gap.y + valueSize * 0.42);

  ctx.restore();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
