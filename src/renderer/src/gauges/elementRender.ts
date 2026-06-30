import type { GaugeElement } from '@shared/types/gaugeElement';
import type { TelemetryFrame } from '@shared/types';
import type { PanelStyle } from './common';
import { clamp, roundRect } from './common';
import { DEFAULT_FONT_FAMILY } from '../lib/fonts';
import {
  arcGeometry,
  arcPath,
  resolveArcTrackWidth,
  dialPoint as layoutDialPoint,
  drawImageElementInLayoutSpace,
  drawStaticTextInLayoutSpace,
  drawTextSlotsInLayoutSpace,
  resolveBarFillColor,
  type GaugeLayoutConfig,
  type TextRole,
} from './gaugeEditorLayout';
import { resolveArcTickCount } from './barGaugeSchema';
import type { FillGradientConfig } from './gaugeGradient';
import {
  fillBarWithGradient,
  resolveFillGradient,
  strokeArcWithGradientSegments,
} from './gaugeGradient';
import { fillColorForRatio } from './gaugeGradient';
import { mergeElementFieldConfig } from './gaugeEditorAdapter';
import { fieldMeta } from './fieldRegistry';
import { drawGpsMapOnCanvas, resolveCourseMarkerOverlay } from './gpsMapDraw';
import type { DataGaugeConfig } from './dataGauge';
import { drawTextIcon } from './textIcons';

export interface ElementRenderOptions {
  ctx: CanvasRenderingContext2D;
  element: GaugeElement;
  frame: TelemetryFrame | null;
  gaugeConfig: DataGaugeConfig;
  panelStyle: PanelStyle;
  layout: GaugeLayoutConfig;
  fillGradient?: FillGradientConfig;
  showScaleLabels?: boolean;
  showArcTicks?: boolean;
  arcTickCount?: number;
}

function elementFieldConfig(
  gaugeConfig: DataGaugeConfig,
  element: GaugeElement,
): Record<string, unknown> {
  return mergeElementFieldConfig(gaugeConfig as unknown as Record<string, unknown>, element);
}

function fieldAccent(element: GaugeElement, gaugeConfig: DataGaugeConfig, cfg: Record<string, unknown>): string {
  if (element.kind === 'bar' || element.kind === 'arc') {
    if (element.color && element.color !== 'default') return element.color;
  }
  if (typeof gaugeConfig.color === 'string' && gaugeConfig.color.length > 0) {
    return gaugeConfig.color;
  }
  if (element.kind === 'bar' || element.kind === 'arc' || element.kind === 'text') {
    return fieldMeta(element.field)?.defaultColor ?? '#3ddc97';
  }
  return '#3ddc97';
}

function fieldFillColor(
  element: Extract<GaugeElement, { field: string }>,
  raw: number,
  ratio: number,
  cfg: Record<string, unknown>,
  accent: string,
  fillGradient?: FillGradientConfig,
): string {
  const meta = fieldMeta(element.field);
  const zoneColor = meta?.getFillColor?.(raw, ratio, cfg, accent);
  return fillColorForRatio(fillGradient, ratio, zoneColor ?? accent);
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
    ctx.lineWidth = major ? 1.4 : 0.8;
    ctx.stroke();
  }
}

function fillBarRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  _rounded: boolean,
): void {
  ctx.fillRect(x, y, w, h);
}

function roleTextForElement(
  role: TextRole,
  meta: NonNullable<ReturnType<typeof fieldMeta>>,
  raw: number,
  cfg: Record<string, unknown>,
): string {
  if (role === 'unit') {
    return meta.formatUnit ? meta.formatUnit(raw, cfg) : meta.getUnit(cfg);
  }
  if (role === 'label') return meta.label.toUpperCase();
  return meta.formatValue(raw, cfg);
}

export function renderGaugeElement(options: ElementRenderOptions): void {
  const { ctx, element, frame, gaugeConfig, panelStyle } = options;
  if (!element.visible) return;

  const fontFamily = panelStyle.fontFamily ?? DEFAULT_FONT_FAMILY;
  const fontScale = panelStyle.fontScale ?? 1;
  const elementGradient = element.kind === 'bar' || element.kind === 'arc'
    ? element.fillGradient
    : undefined;
  const gradient = resolveFillGradient({
    fillGradient: elementGradient ?? options.fillGradient ?? gaugeConfig.fillGradient as FillGradientConfig,
  });

  switch (element.kind) {
    case 'bar': {
      const cfg = elementFieldConfig(gaugeConfig, element);
      const meta = fieldMeta(element.field);
      if (!meta) return;
      const raw = (frame?.[element.field] as number | undefined) ?? 0;
      const ratio = meta.getRatio(raw, cfg);
      const accent = fieldAccent(element, gaugeConfig, cfg);
      const color = fieldFillColor(element, raw, ratio, cfg, accent, gradient.enabled ? gradient : undefined);
      const track = element.rect;
      const fillW = Math.max(1, track.w * clamp(ratio, 0, 1));
      const barFill = resolveBarFillColor(
        { rect: track, rounded: element.rounded, color: element.color },
        color,
      );
      const useBarGradient = gradient.enabled && gradient.stops.length >= 2 && element.color === 'default';

      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      fillBarRect(ctx, track.x, track.y, track.w, track.h, element.rounded);
      if (useBarGradient) {
        fillBarWithGradient(
          ctx, track.x, track.y, track.w, track.h, ratio, gradient.stops, element.rounded, roundRect,
        );
      } else {
        ctx.fillStyle = barFill;
        fillBarRect(ctx, track.x, track.y, fillW, track.h, element.rounded);
      }
      break;
    }
    case 'arc': {
      const cfg = elementFieldConfig(gaugeConfig, element);
      const meta = fieldMeta(element.field);
      if (!meta) return;
      const raw = (frame?.[element.field] as number | undefined) ?? 0;
      const ratio = meta.getRatio(raw, cfg);
      const scaleMax = meta.getScaleMax(cfg);
      const accent = fieldAccent(element, gaugeConfig, cfg);
      const color = fieldFillColor(element, raw, ratio, cfg, accent, gradient.enabled ? gradient : undefined);
      const clamped = clamp(ratio, 0, 1);
      const { cx, cy, r } = arcGeometry(element.center, element.radius);
      const localTrackW = resolveArcTrackWidth(r, element.trackWidth);
      const sweep = ((element.endDeg - element.startDeg) + 360) % 360;
      const valueDeg = (element.startDeg + sweep * clamped) % 360;
      const showTicks = element.showArcTicks ?? options.showArcTicks ?? true;
      const showLabels = element.showScaleLabels ?? options.showScaleLabels ?? true;
      const tickCount = element.arcTickCount ?? options.arcTickCount ?? 8;

      ctx.save();
      const track = new Path2D(arcPath(cx, cy, r, element.startDeg, element.endDeg));
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = localTrackW;
      ctx.lineCap = 'round';
      ctx.stroke(track);

      if (clamped > 0.002) {
        if (gradient.enabled && gradient.stops.length >= 2) {
          strokeArcWithGradientSegments(
            ctx,
            element.startDeg,
            element.endDeg,
            clamped,
            localTrackW,
            gradient.stops,
            (deg0, deg1) => new Path2D(arcPath(cx, cy, r, deg0, deg1)),
          );
        } else {
          const valueTrack = new Path2D(arcPath(cx, cy, r, element.startDeg, valueDeg));
          ctx.strokeStyle = color;
          ctx.lineCap = 'round';
          ctx.stroke(valueTrack);
        }
      }

      if (showTicks) {
        drawArcHashMarks(ctx, element.startDeg, sweep, tickCount, (td) => {
          const inner = layoutDialPoint(cx, cy, r - localTrackW * 0.8, td);
          const outer = layoutDialPoint(cx, cy, r + localTrackW * 0.55, td);
          return { inner, outer };
        });
      }

      if (showLabels) {
        const labelR = Math.max(8, r - localTrackW * 1.6);
        const scaleSize = Math.max(7, 9 * fontScale);
        ctx.font = `600 ${Math.floor(scaleSize)}px ${fontFamily}, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const minPt = layoutDialPoint(cx, cy, labelR, element.startDeg);
        const maxPt = layoutDialPoint(cx, cy, labelR, element.endDeg);
        ctx.fillText('0', minPt.x, minPt.y);
        ctx.fillText(meta.formatScaleMaxLabel(scaleMax, cfg), maxPt.x, maxPt.y);
      }
      ctx.restore();
      break;
    }
    case 'text': {
      const cfg = elementFieldConfig(gaugeConfig, element);
      const meta = fieldMeta(element.field);
      if (!meta) return;
      const raw = (frame?.[element.field] as number | undefined) ?? 0;
      const accent = fieldAccent(element, gaugeConfig, cfg);
      drawTextSlotsInLayoutSpace(ctx, element, {
        accentColor: accent,
        fontFamily,
        fontScale,
        roleText: (role) => roleTextForElement(role, meta, raw, cfg),
      });
      break;
    }
    case 'map': {
      const route = gaugeConfig.fullTrack ?? [];
      const lat = frame?.lat as number | undefined;
      const lon = frame?.lon as number | undefined;
      const mapRect = element.rect;
      const trailColor = element.trailColor ?? gaugeConfig.trailColor ?? '#3ddc97';
      const cursorColor = element.cursorColor ?? gaugeConfig.cursorColor ?? '#ffffff';
      const sizeScale = Math.min(mapRect.w, mapRect.h);

      if (route.length < 2 && lat === undefined) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = `500 ${Math.floor(sizeScale * 0.11 * fontScale)}px ${fontFamily}, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('no GPS', mapRect.x + mapRect.w / 2, mapRect.y + mapRect.h / 2);
        ctx.textAlign = 'left';
        break;
      }

      const markerCfg = {
        ...gaugeConfig,
        showCourseStart: element.showCourseStart ?? gaugeConfig.showCourseStart,
        showCourseFinish: element.showCourseFinish ?? gaugeConfig.showCourseFinish,
        startMarkerStyle: element.startMarkerStyle ?? gaugeConfig.startMarkerStyle,
        finishMarkerStyle: element.finishMarkerStyle ?? gaugeConfig.finishMarkerStyle,
        startMarkerColor: element.startMarkerColor ?? gaugeConfig.startMarkerColor,
        finishMarkerColor: element.finishMarkerColor ?? gaugeConfig.finishMarkerColor,
        markerLength: element.markerLength ?? gaugeConfig.markerLength,
        markerWidth: element.markerWidth ?? gaugeConfig.markerWidth,
      };
      drawGpsMapOnCanvas(
        ctx,
        mapRect,
        route,
        lat,
        lon,
        trailColor,
        cursorColor,
        sizeScale,
        resolveCourseMarkerOverlay(
          markerCfg as unknown as Record<string, unknown>,
          gaugeConfig.courseStart,
          gaugeConfig.courseFinish,
        ),
      );
      break;
    }
    case 'staticText': {
      const accent = typeof gaugeConfig.color === 'string' ? gaugeConfig.color : '#3ddc97';
      drawStaticTextInLayoutSpace(
        ctx,
        element.text,
        element.pos,
        element.fontSize,
        element.color,
        accent,
        fontFamily,
        fontScale,
      );
      break;
    }
    case 'image': {
      const accent = typeof gaugeConfig.color === 'string' ? gaugeConfig.color : '#3ddc97';
      if (element.source.type === 'builtin') {
        drawImageElementInLayoutSpace(
          ctx,
          element.pos,
          element.size,
          element.color,
          accent,
          element.source.icon,
          fontScale,
        );
      } else if (element.source.src) {
        const h = Math.max(2, element.size * fontScale);
        const w = h;
        const fill = !element.color || element.color === 'default' ? accent : element.color;
        const img = new Image();
        img.src = element.source.src;
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, element.pos.x - w / 2, element.pos.y - h / 2, w, h);
        } else {
          drawTextIcon(ctx, 'pin', element.pos.x - w / 2, element.pos.y, h, fill);
        }
      }
      break;
    }
  }
}

export function renderGaugeElements(
  ctx: CanvasRenderingContext2D,
  layout: GaugeLayoutConfig,
  frame: TelemetryFrame | null,
  gaugeConfig: DataGaugeConfig,
  panelStyle: PanelStyle,
): void {
  for (const element of layout.elements) {
    renderGaugeElement({
      ctx,
      element,
      frame,
      gaugeConfig,
      panelStyle,
      layout,
      fillGradient: gaugeConfig.fillGradient as FillGradientConfig | undefined,
      showScaleLabels: gaugeConfig.showScaleLabels as boolean | undefined,
      showArcTicks: gaugeConfig.showArcTicks as boolean | undefined,
      arcTickCount: gaugeConfig.arcTickCount as number | undefined,
    });
  }
}
