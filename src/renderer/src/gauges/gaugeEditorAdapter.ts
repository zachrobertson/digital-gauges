import type { GaugePlugin, TelemetryField } from '@shared/types';
import type { BarGaugeDisplayStyle, DataGaugeDisplayStyle } from './barGaugeSchema';
import { barGaugeSchemaProperties } from './barGaugeSchema';
import type { FillGradientConfig } from './gaugeGradient';
import { colorAtGradient, resolveFillGradient } from './gaugeGradient';
import { DATA_GAUGE_PLUGIN_ID, fieldMeta, fieldLabel } from './fieldRegistry';
import { isDataGaugePlugin, resolveDataGaugeDisplayStyle } from './dataGauge';
import { hrZoneColor } from './heartRate';
import { powerZoneColor } from './power';

export type GaugeEditorKind = 'telemetry' | 'gps';

export interface GaugeEditorMeta {
  label: string;
  unit: string;
  getUnit?: (config: Record<string, unknown>) => string;
  getScaleMax: (config: Record<string, unknown>) => number;
  getScaleMaxRange?: (config: Record<string, unknown>) => { min: number; max: number; step: number };
  patchScaleMax: (config: Record<string, unknown>, value: number) => Record<string, unknown>;
  scaleMaxRange: { min: number; max: number; step: number };
  formatPreviewValue: (scaleMax: number, ratio: number, config?: Record<string, unknown>) => string;
}

const LEGACY_PLUGIN_FIELDS: Record<string, TelemetryField> = {
  'builtin:speedometer': 'speed',
  'builtin:power': 'power',
  'builtin:hr': 'hr',
  'builtin:cadence': 'cadence',
};

const LEGACY_PLUGIN_META: Record<string, GaugeEditorMeta> = {
  'builtin:gpsMiniMap': {
    label: 'Route',
    unit: '',
    getScaleMax: () => 100,
    patchScaleMax: (c) => c,
    scaleMaxRange: { min: 0, max: 100, step: 1 },
    formatPreviewValue: () => '',
  },
};

function metaFromField(field: TelemetryField): GaugeEditorMeta {
  const fm = fieldMeta(field)!;
  return {
    label: fm.label,
    unit: fm.unit,
    getUnit: fm.getUnit,
    getScaleMax: fm.getScaleMax,
    getScaleMaxRange: fm.getScaleMaxRange,
    patchScaleMax: fm.patchScaleMax,
    scaleMaxRange: fm.getScaleMaxRange({}),
    formatPreviewValue: (scaleMax, ratio, config) => {
      const raw = scaleMax * ratio;
      return fm.formatValue(raw, config ?? {});
    },
  };
}

export function resolveGaugeField(plugin: GaugePlugin, config: Record<string, unknown>): TelemetryField | null {
  if (isDataGaugePlugin(plugin.id)) {
    const displayStyle = resolveDataGaugeDisplayStyle(config);
    if (displayStyle === 'map') return null;
    return (config.field as TelemetryField | undefined) ?? 'speed';
  }
  return LEGACY_PLUGIN_FIELDS[plugin.id] ?? null;
}

export function gaugeEditorKind(plugin: GaugePlugin, config?: Record<string, unknown>): GaugeEditorKind | null {
  if (isDataGaugePlugin(plugin.id)) {
    const displayStyle = resolveDataGaugeDisplayStyle(config ?? plugin.defaultConfig);
    return displayStyle === 'map' ? 'gps' : 'telemetry';
  }
  if (plugin.id === 'builtin:gpsMiniMap') return 'gps';
  if (plugin.id in LEGACY_PLUGIN_FIELDS) return 'telemetry';
  if (Object.keys(barGaugeSchemaProperties).every((k) => k in plugin.schema.properties)) {
    return 'telemetry';
  }
  return null;
}

export function supportsGaugeEditor(plugin: GaugePlugin, config?: Record<string, unknown>): boolean {
  return gaugeEditorKind(plugin, config) != null;
}

export function gaugeEditorMeta(plugin: GaugePlugin, config?: Record<string, unknown>): GaugeEditorMeta | null {
  if (isDataGaugePlugin(plugin.id)) {
    const merged = { ...plugin.defaultConfig, ...config };
    const displayStyle = resolveDataGaugeDisplayStyle(merged);
    if (displayStyle === 'map') return LEGACY_PLUGIN_META['builtin:gpsMiniMap'] ?? null;
    const field = (merged.field as TelemetryField | undefined) ?? 'speed';
    const fm = fieldMeta(field);
    return fm ? metaFromField(field) : null;
  }
  const field = LEGACY_PLUGIN_FIELDS[plugin.id];
  if (field) return metaFromField(field);
  return LEGACY_PLUGIN_META[plugin.id] ?? null;
}

export function resolveDisplayStyle(config: Record<string, unknown>): BarGaugeDisplayStyle {
  const v = config.displayStyle;
  if (v === 'arc' || v === 'text') return v;
  return 'bar';
}

export function resolveDataDisplayStyle(config: Record<string, unknown>): DataGaugeDisplayStyle {
  return resolveDataGaugeDisplayStyle(config);
}

export function resolveAccentColor(config: Record<string, unknown>, plugin: GaugePlugin): string {
  if (isDataGaugePlugin(plugin.id)) {
    const displayStyle = resolveDataGaugeDisplayStyle(config);
    if (displayStyle === 'map') {
      const fromConfig = config.trailColor;
      if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig;
      return '#3ddc97';
    }
  }
  if (plugin.id === 'builtin:gpsMiniMap') {
    const fromConfig = config.trailColor;
    if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig;
    const fromDefault = (plugin.defaultConfig as { trailColor?: string }).trailColor;
    if (typeof fromDefault === 'string' && fromDefault.length > 0) return fromDefault;
    return '#3ddc97';
  }
  const fromConfig = config.color;
  if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig;
  const field = resolveGaugeField(plugin, config);
  if (field) return fieldMeta(field)?.defaultColor ?? '#3ddc97';
  const fromDefault = (plugin.defaultConfig as { color?: string }).color;
  if (typeof fromDefault === 'string' && fromDefault.length > 0) return fromDefault;
  return '#3ddc97';
}

/** Fill color used by bar/arc on the video canvas for sidebar preview sync. */
export function previewGaugeFillColor(
  plugin: GaugePlugin,
  config: Record<string, unknown>,
  previewRatio: number,
): string {
  const accent = resolveAccentColor(config, plugin);
  const ratio = Math.max(0, Math.min(1, previewRatio));
  const gradient = resolveFillGradient({ fillGradient: config.fillGradient as FillGradientConfig | undefined });

  if (gradient.enabled) {
    return colorAtGradient(gradient.stops, ratio);
  }

  const field = resolveGaugeField(plugin, config);
  if (field === 'power') {
    const ftp = Number(config.ftp ?? 250);
    const watts = ratio * Math.round(ftp * 1.5);
    return powerZoneColor(watts, ftp) ?? accent;
  }
  if (field === 'hr') {
    const maxHr = Number(config.maxHr ?? 190);
    const hr = ratio * maxHr;
    return hr > 0 ? hrZoneColor(hr / maxHr) : accent;
  }
  return accent;
}

export function derivedTextForRole(
  role: 'label' | 'value' | 'unit',
  meta: GaugeEditorMeta,
  scaleMax: number,
  ratio: number,
  config?: Record<string, unknown>,
): string {
  if (role === 'label') return meta.label.toUpperCase();
  if (role === 'unit') return meta.getUnit?.(config ?? {}) ?? meta.unit;
  return meta.formatPreviewValue(scaleMax, ratio, config);
}

/** Data-only schema keys shown outside the visual editor. */
export function dataSchemaKeys(plugin: GaugePlugin): string[] {
  const layoutKeys = new Set([
    ...Object.keys(barGaugeSchemaProperties),
    'panelOpacity', 'panelBg', 'panelBorder', 'fontScale', 'fontFamily', 'cornerStyle',
    'layout', 'color', 'fillGradient', 'showArcTicks', 'arcTickCount',
    'maxSpeedKmh', 'maxHr', 'maxCadence', 'ftp', 'scaleMax', 'field',
    ...(plugin.id === 'builtin:speedometer' || isDataGaugePlugin(plugin.id) ? ['units'] : []),
    ...(plugin.id === 'builtin:gpsMiniMap' || isDataGaugePlugin(plugin.id)
      ? ['trailColor', 'cursorColor', 'routeScope'] : []),
  ]);
  return Object.keys(plugin.schema.properties).filter((k) => !layoutKeys.has(k));
}

export const SPEED_UNIT_OPTIONS = [
  { value: 'kmh', label: 'km/h' },
  { value: 'mph', label: 'mph' },
] as const;

export const FONT_OPTIONS = [
  { value: 'Inter', label: 'Inter' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Roboto Condensed', label: 'Roboto Condensed' },
  { value: 'Source Sans 3', label: 'Source Sans 3' },
];

export const DISPLAY_STYLE_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'arc', label: 'Arc' },
  { value: 'text', label: 'Text' },
  { value: 'map', label: 'Map' },
] as const;

export { fieldLabel };
