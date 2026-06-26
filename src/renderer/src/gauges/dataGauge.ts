import type { GaugePlugin, TelemetryField } from '@shared/types';
import { appearanceDefaults, appearanceSchemaProperties } from './appearanceSchema';
import {
  barGaugeDefaults,
  barGaugeSchemaProperties,
  type DataGaugeDisplayStyle,
} from './barGaugeSchema';
import { fillPanel, panelStyleFromConfig, withGaugeBoundsClip } from './common';
import { DATA_GAUGE_PLUGIN_ID, SCALAR_GAUGE_FIELDS } from './fieldRegistry';
import {
  DEFAULT_GAUGE_LAYOUT,
  defaultVideoRectForLayout,
  mergeGaugeLayout,
  withLayoutVideoTransform,
  type GaugeLayoutConfig,
} from './gaugeEditorLayout';
import { renderGaugeElements } from './elementRender';
import type { MarkerStyle } from '@shared/types/gaugeElement';
import type { GpsRouteScope } from './gpsMiniMap';
import { isCompositeGaugeConfig } from '../lib/gaugeElementFactory';
import { isDataElement } from '@shared/types/gaugeElement';

export interface DataGaugeConfig {
  /** @deprecated Use per-element field bindings in layout.elements. */
  displayStyle?: DataGaugeDisplayStyle;
  /** @deprecated Use per-element field bindings in layout.elements. */
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
  showCourseMarkers?: boolean;
  showCourseStart?: boolean;
  showCourseFinish?: boolean;
  startMarkerStyle?: MarkerStyle;
  finishMarkerStyle?: MarkerStyle;
  startMarkerColor?: string;
  finishMarkerColor?: string;
  markerScale?: number;
  markerLength?: number;
  markerWidth?: number;
  courseStart?: { lat: number; lon: number } | null;
  courseFinish?: { lat: number; lon: number } | null;
  layout?: GaugeLayoutConfig;
  panelOpacity?: number;
  panelBg?: string;
  panelBorder?: string;
  fontScale?: number;
  fontFamily?: string;
  frameShape?: 'rectangle' | 'ellipse';
  frameCornerRadius?: number;
  /** @deprecated */
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
    ...appearanceDefaults,
    ...barGaugeDefaults,
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    routeScope: 'video',
    showCourseStart: true,
    showCourseFinish: true,
    startMarkerStyle: 'line',
    finishMarkerStyle: 'line',
    startMarkerColor: '#22c55e',
    finishMarkerColor: '#111111',
    markerLength: 56,
    markerWidth: 30,
    layout: DEFAULT_GAUGE_LAYOUT,
  },
  schema: {
    type: 'object',
    properties: {
      ...barGaugeSchemaProperties,
      ...appearanceSchemaProperties,
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const cfg = config as DataGaugeConfig;
    if (!isCompositeGaugeConfig(cfg as unknown as Record<string, unknown>)) {
      return;
    }
    renderCompositeGauge(ctx, frame, cfg, rect);
  },
};

function renderCompositeGauge(
  ctx: CanvasRenderingContext2D,
  frame: Parameters<GaugePlugin['renderToCanvas']>[1],
  config: DataGaugeConfig,
  rect: { x: number; y: number; w: number; h: number },
): void {
  withGaugeBoundsClip(ctx, rect, () => {
    const panelStyle = panelStyleFromConfig(config);
    const layout = mergeGaugeLayout(config.layout);
    withLayoutVideoTransform(ctx, layout, rect, () => {
      fillPanel(ctx, layout.gaugeRect, panelStyle);
      renderGaugeElements(ctx, layout, frame, config, panelStyle);
    });
  });
}

export function isMapGaugeConfig(pluginId: string, config: Record<string, unknown>): boolean {
  if (!isDataGaugePlugin(pluginId)) return pluginId === 'builtin:gpsMiniMap';
  if (!isCompositeGaugeConfig(config)) return resolveDataGaugeDisplayStyle(config) === 'map';
  const layout = config.layout as GaugeLayoutConfig | undefined;
  return layout?.elements?.some((e) => e.kind === 'map') ?? false;
}

export function layoutTemplateForGauge(
  pluginId: string,
  config: Record<string, unknown>,
): 'gps' | 'telemetry' {
  return isMapGaugeConfig(pluginId, config) ? 'gps' : 'telemetry';
}

export function defaultRectForGauge(
  layout: GaugeLayoutConfig = DEFAULT_GAUGE_LAYOUT,
  videoWidth = 1920,
  videoHeight = 1080,
): { x: number; y: number; w: number; h: number } {
  const hasMap = layout.elements.some((e) => e.kind === 'map');
  if (hasMap) {
    return defaultVideoRectForLayout(layout, videoWidth, videoHeight, 0.18, 0.78, 0.04);
  }
  return defaultVideoRectForLayout(layout, videoWidth, videoHeight, 0.18, 0.04, 0.74);
}

/** @deprecated Use defaultRectForGauge */
export function defaultRectForDisplayStyle(
  displayStyle: DataGaugeDisplayStyle,
  videoWidth = 1920,
  videoHeight = 1080,
): { x: number; y: number; w: number; h: number } {
  if (displayStyle === 'map') {
    return defaultVideoRectForLayout(
      mergeGaugeLayout(null, 'gps'),
      videoWidth,
      videoHeight,
      0.18,
      0.78,
      0.04,
    );
  }
  return defaultVideoRectForLayout(undefined, videoWidth, videoHeight, 0.18, 0.04, 0.74);
}

export function gaugeElementFields(config: Record<string, unknown>): TelemetryField[] {
  if (!isCompositeGaugeConfig(config)) return [];
  const layout = config.layout as GaugeLayoutConfig;
  return layout.elements
    .filter(isDataElement)
    .filter((e) => e.kind !== 'map')
    .map((e) => e.field);
}
