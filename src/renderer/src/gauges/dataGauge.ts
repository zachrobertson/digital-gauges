import type { GaugePlugin, TelemetryField } from '@shared/types';
import { appearanceDefaults, appearanceSchemaProperties } from './appearanceSchema';
import {
  barGaugeDefaults,
  barGaugeSchemaProperties,
  resolveArcTickCount,
  resolveShowArcTicks,
  resolveShowScaleLabels,
  type DataGaugeDisplayStyle,
} from './barGaugeSchema';
import { renderBarGauge, resolveDisplayStyle } from './barGauge';
import { fillPanel, panelStyleFromConfig, withGaugeBoundsClip } from './common';
import {
  DATA_GAUGE_PLUGIN_ID,
  defaultConfigForField,
  fieldMeta,
  SCALAR_GAUGE_FIELDS,
} from './fieldRegistry';
import {
  DEFAULT_GPS_GAUGE_LAYOUT,
  defaultVideoRectForLayout,
  drawLayoutTextInLayoutSpace,
  mergeGaugeLayout,
  withLayoutVideoTransform,
  type GaugeLayoutConfig,
  type TextRole,
} from './gaugeEditorLayout';
import { fillColorForRatio } from './gaugeGradient';
import { drawGpsMapOnCanvas } from './gpsMapDraw';
import type { GpsRouteScope } from './gpsMiniMap';

export interface DataGaugeConfig {
  displayStyle: DataGaugeDisplayStyle;
  field?: TelemetryField;
  scaleMax?: number;
  units?: 'kmh' | 'mph';
  ftp?: number;
  maxHr?: number;
  maxCadence?: number;
  maxSpeedKmh?: number;
  color?: string;
  trailColor?: string;
  cursorColor?: string;
  routeScope?: GpsRouteScope;
  fullTrack?: { lat: number; lon: number }[];
  layout?: GaugeLayoutConfig;
  panelOpacity?: number;
  panelBg?: string;
  panelBorder?: string;
  fontScale?: number;
  fontFamily?: string;
  cornerStyle?: 'rounded' | 'square' | 'pill' | 'circle';
  textLayout?: string;
  fillGradient?: unknown;
  showScaleLabels?: boolean;
  showArcTicks?: boolean;
  arcTickCount?: number;
}

export function resolveDataGaugeDisplayStyle(config: Record<string, unknown>): DataGaugeDisplayStyle {
  const v = config.displayStyle;
  if (v === 'map' || v === 'arc' || v === 'text') return v;
  return 'bar';
}

export function isDataGaugePlugin(pluginId: string): boolean {
  return pluginId === DATA_GAUGE_PLUGIN_ID;
}

export const dataGauge: GaugePlugin<DataGaugeConfig> = {
  id: DATA_GAUGE_PLUGIN_ID,
  name: 'Data Gauge',
  description: 'Configurable gauge for any telemetry field.',
  fields: SCALAR_GAUGE_FIELDS,
  defaultRect: defaultVideoRectForLayout(undefined, 1920, 1080, 0.18, 0.04, 0.74),
  defaultConfig: {
    field: 'speed',
    ...defaultConfigForField('speed'),
    ...appearanceDefaults,
    ...barGaugeDefaults,
    displayStyle: 'bar',
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    routeScope: 'video',
  },
  schema: {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        title: 'Data field',
        format: 'select',
        default: 'speed',
        group: 'Data',
      },
      scaleMax: {
        type: 'number',
        title: 'Scale max',
        minimum: 1,
        maximum: 10000,
        step: 1,
        default: 80,
        group: 'Data',
      },
      units: {
        type: 'string',
        title: 'Speed units',
        enum: ['kmh', 'mph'],
        format: 'select',
        default: 'kmh',
        group: 'Data',
      },
      ftp: {
        type: 'number',
        title: 'FTP (W)',
        minimum: 50,
        maximum: 600,
        step: 5,
        default: 250,
        group: 'Data',
      },
      maxHr: {
        type: 'number',
        title: 'Max HR (bpm)',
        minimum: 120,
        maximum: 220,
        step: 1,
        default: 190,
        group: 'Data',
      },
      maxCadence: {
        type: 'number',
        title: 'Scale full (rpm)',
        minimum: 60,
        maximum: 200,
        step: 5,
        default: 120,
        group: 'Data',
      },
      maxSpeedKmh: {
        type: 'number',
        title: 'Scale full (km/h)',
        minimum: 10,
        maximum: 200,
        step: 5,
        default: 80,
        group: 'Data',
      },
      color: {
        type: 'string',
        title: 'Accent color',
        format: 'color',
        default: '#3ddc97',
        group: 'Data',
      },
      routeScope: {
        type: 'string',
        title: 'Route scope',
        enum: ['video', 'full'],
        format: 'select',
        default: 'video',
        group: 'Data',
        description: 'Video — route within the clip. Full — entire imported track.',
      },
      trailColor: {
        type: 'string',
        title: 'Trail color',
        format: 'color',
        default: '#3ddc97',
        group: 'Data',
      },
      cursorColor: {
        type: 'string',
        title: 'Cursor color',
        format: 'color',
        default: '#ffffff',
        group: 'Data',
      },
      ...barGaugeSchemaProperties,
      ...appearanceSchemaProperties,
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const cfg = config as unknown as Record<string, unknown>;
    const displayStyle = resolveDataGaugeDisplayStyle(cfg);
    if (displayStyle === 'map') {
      renderMapGauge(ctx, config, rect, frame);
      return;
    }
    renderScalarGauge(ctx, frame, config, rect, displayStyle);
  },
};

function renderScalarGauge(
  ctx: CanvasRenderingContext2D,
  frame: Parameters<GaugePlugin['renderToCanvas']>[1],
  config: DataGaugeConfig,
  rect: { x: number; y: number; w: number; h: number },
  displayStyle: DataGaugeDisplayStyle,
): void {
  const cfg = config as unknown as Record<string, unknown>;
  const field = config.field ?? 'speed';
  const meta = fieldMeta(field);
  if (!meta) return;

  const panelStyle = panelStyleFromConfig(config);
  const raw = (frame?.[field] as number | undefined) ?? 0;
  const ratio = meta.getRatio(raw, cfg);
  const scaleMax = meta.getScaleMax(cfg);
  const accent = typeof config.color === 'string' && config.color.length > 0
    ? config.color
    : meta.defaultColor;
  const zoneColor = meta.getFillColor?.(raw, ratio, cfg, accent);
  const color = fillColorForRatio(
    config.fillGradient as Parameters<typeof fillColorForRatio>[0],
    ratio,
    zoneColor ?? accent,
  );

  renderBarGauge({
    ctx,
    rect,
    panelStyle,
    label: meta.label.toLowerCase(),
    valueText: meta.formatValue(raw, cfg),
    unitText: meta.getUnit(cfg),
    ratio,
    color,
    displayStyle: resolveDisplayStyle(displayStyle === 'map' ? 'bar' : displayStyle),
    textLayout: config.textLayout as Parameters<typeof renderBarGauge>[0]['textLayout'],
    layout: config.layout,
    fillGradient: config.fillGradient as Parameters<typeof renderBarGauge>[0]['fillGradient'],
    showScaleLabels: resolveShowScaleLabels(config),
    showArcTicks: resolveShowArcTicks(config),
    arcTickCount: resolveArcTickCount(config),
    scaleMinLabel: '0',
    scaleMaxLabel: meta.formatScaleMaxLabel(scaleMax, cfg),
  });
}

function roleText(role: TextRole): string {
  if (role === 'label') return 'ROUTE';
  return '';
}

function renderMapGauge(
  ctx: CanvasRenderingContext2D,
  config: DataGaugeConfig,
  rect: { x: number; y: number; w: number; h: number },
  frame?: Parameters<GaugePlugin['renderToCanvas']>[1],
): void {
  withGaugeBoundsClip(ctx, rect, () => {
    const panelStyle = panelStyleFromConfig(config);
    const route = config.fullTrack ?? [];
    const lat = frame?.lat as number | undefined;
    const lon = frame?.lon as number | undefined;
    const layout = mergeGaugeLayout(config.layout, 'gps');
    const trailColor = config.trailColor ?? '#3ddc97';
    const cursorColor = config.cursorColor ?? '#ffffff';

    withLayoutVideoTransform(ctx, layout, rect, () => {
      fillPanel(ctx, layout.gaugeRect, panelStyle);

      const mapRect = layout.mapRect;
      const sizeScale = Math.min(layout.mapRect.w, layout.mapRect.h);

      if (route.length < 2 && lat === undefined) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = `500 ${Math.floor(sizeScale * 0.11 * (panelStyle.fontScale ?? 1))}px ${panelStyle.fontFamily ?? 'Inter'}, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('no GPS', mapRect.x + mapRect.w / 2, mapRect.y + mapRect.h / 2);
        ctx.textAlign = 'left';
        drawLayoutTextInLayoutSpace(ctx, layout, {
          accentColor: trailColor,
          fontFamily: panelStyle.fontFamily,
          fontScale: panelStyle.fontScale,
          roleText: roleText,
          skipEmpty: true,
        });
        return;
      }

      drawGpsMapOnCanvas(ctx, mapRect, route, lat, lon, trailColor, cursorColor, sizeScale);
      drawLayoutTextInLayoutSpace(ctx, layout, {
        accentColor: trailColor,
        fontFamily: panelStyle.fontFamily,
        fontScale: panelStyle.fontScale,
        roleText: roleText,
        skipEmpty: true,
      });
    });
  });
}

export function isMapGaugeConfig(pluginId: string, config: Record<string, unknown>): boolean {
  if (isDataGaugePlugin(pluginId)) return resolveDataGaugeDisplayStyle(config) === 'map';
  return pluginId === 'builtin:gpsMiniMap';
}

export function layoutTemplateForGauge(
  pluginId: string,
  config: Record<string, unknown>,
): 'gps' | 'telemetry' {
  return isMapGaugeConfig(pluginId, config) ? 'gps' : 'telemetry';
}

export function defaultRectForDisplayStyle(
  displayStyle: DataGaugeDisplayStyle,
  videoWidth = 1920,
  videoHeight = 1080,
): { x: number; y: number; w: number; h: number } {
  if (displayStyle === 'map') {
    return defaultVideoRectForLayout(DEFAULT_GPS_GAUGE_LAYOUT, videoWidth, videoHeight, 0.18, 0.78, 0.04);
  }
  return defaultVideoRectForLayout(undefined, videoWidth, videoHeight, 0.18, 0.04, 0.74);
}
