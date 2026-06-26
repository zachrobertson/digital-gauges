import type { GaugePlugin, TelemetryField } from '@shared/types';
import type { GaugeElement } from '@shared/types/gaugeElement';
import { isDataElement } from '@shared/types/gaugeElement';
import type { BarGaugeDisplayStyle } from './barGaugeSchema';
import { barGaugeSchemaProperties } from './barGaugeSchema';
import type { FillGradientConfig } from './gaugeGradient';
import {
  colorAtGradient,
  resolveElementFillGradient,
} from './gaugeGradient';
import { DATA_GAUGE_PLUGIN_ID, fieldMeta, fieldLabel } from './fieldRegistry';
import { isDataGaugePlugin } from './dataGauge';
import type { GaugeLayoutConfig } from './gaugeEditorLayout';
import { isCompositeGaugeConfig } from '../lib/gaugeElementFactory';
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
  formatPreviewUnit?: (scaleMax: number, ratio: number, config?: Record<string, unknown>) => string;
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
      const displayVal = scaleMax * ratio;
      const cfg = config ?? {};
      const raw = fm.displayToRaw ? fm.displayToRaw(displayVal, cfg) : displayVal;
      return fm.formatValue(raw, cfg);
    },
    formatPreviewUnit: fm.formatUnit
      ? (scaleMax, ratio, config) => {
          const displayVal = scaleMax * ratio;
          const cfg = config ?? {};
          const raw = fm.displayToRaw ? fm.displayToRaw(displayVal, cfg) : displayVal;
          return fm.formatUnit!(raw, cfg);
        }
      : undefined,
  };
}

export function firstDataElement(config: Record<string, unknown>): GaugeElement | null {
  if (!isCompositeGaugeConfig(config)) return null;
  const layout = config.layout as GaugeLayoutConfig;
  return layout.elements.find((e) => isDataElement(e) && e.visible) ?? layout.elements.find(isDataElement) ?? null;
}

export function elementEditorMeta(element: GaugeElement | null): GaugeEditorMeta | null {
  if (!element || !isDataElement(element) || element.kind === 'map') {
    return element?.kind === 'map' ? LEGACY_PLUGIN_META['builtin:gpsMiniMap'] ?? null : null;
  }
  const fm = fieldMeta(element.field);
  return fm ? metaFromField(element.field) : null;
}

export function resolveGaugeField(
  plugin: GaugePlugin,
  config: Record<string, unknown>,
  element?: GaugeElement | null,
): TelemetryField | null {
  if (isDataGaugePlugin(plugin.id)) {
    const el = element ?? firstDataElement(config);
    if (!el || !isDataElement(el) || el.kind === 'map') return null;
    return el.field;
  }
  return LEGACY_PLUGIN_FIELDS[plugin.id] ?? null;
}

export function gaugeEditorKind(plugin: GaugePlugin, config?: Record<string, unknown>): GaugeEditorKind | null {
  if (isDataGaugePlugin(plugin.id)) {
    if (!isCompositeGaugeConfig(config ?? {})) return null;
    const layout = (config ?? {}).layout as GaugeLayoutConfig;
    const hasMap = layout.elements.some((e) => e.kind === 'map' && e.visible);
    return hasMap ? 'gps' : 'telemetry';
  }
  if (plugin.id === 'builtin:gpsMiniMap') return 'gps';
  if (plugin.id in LEGACY_PLUGIN_FIELDS) return 'telemetry';
  if (Object.keys(barGaugeSchemaProperties).every((k) => k in plugin.schema.properties)) {
    return 'telemetry';
  }
  return null;
}

export function supportsGaugeEditor(plugin: GaugePlugin, config?: Record<string, unknown>): boolean {
  if (isDataGaugePlugin(plugin.id)) {
    return isCompositeGaugeConfig(config ?? plugin.defaultConfig);
  }
  return gaugeEditorKind(plugin, config) != null;
}

export function gaugeEditorMeta(
  plugin: GaugePlugin,
  config?: Record<string, unknown>,
  element?: GaugeElement | null,
): GaugeEditorMeta | null {
  if (isDataGaugePlugin(plugin.id)) {
    const merged = { ...plugin.defaultConfig, ...config };
    if (element != null) {
      const fromSelected = elementEditorMeta(element);
      if (fromSelected) return fromSelected;
    }
    return elementEditorMeta(firstDataElement(merged));
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

export function resolveAccentColor(
  config: Record<string, unknown>,
  plugin: GaugePlugin,
  element?: GaugeElement | null,
): string {
  if (isDataGaugePlugin(plugin.id)) {
    const el = element ?? firstDataElement(config);
    if (el?.kind === 'map') {
      const fromEl = el.trailColor;
      if (typeof fromEl === 'string' && fromEl.length > 0) return fromEl;
      const fromConfig = config.trailColor;
      if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig;
      return '#3ddc97';
    }
    if (el && (el.kind === 'bar' || el.kind === 'arc' || el.kind === 'text')) {
      const field = el.field;
      const fromConfig = config.color;
      if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig;
      return fieldMeta(field)?.defaultColor ?? '#3ddc97';
    }
  }
  if (plugin.id === 'builtin:gpsMiniMap') {
    const fromConfig = config.trailColor;
    if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig;
    return '#3ddc97';
  }
  const fromConfig = config.color;
  if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig;
  const field = resolveGaugeField(plugin, config, element);
  if (field) return fieldMeta(field)?.defaultColor ?? '#3ddc97';
  return '#3ddc97';
}

export function previewGaugeFillColor(
  plugin: GaugePlugin,
  config: Record<string, unknown>,
  previewRatio: number,
  element?: GaugeElement | null,
): string {
  const accent = resolveAccentColor(config, plugin, element);
  const ratio = Math.max(0, Math.min(1, previewRatio));
  const gradient = resolveElementFillGradient(element, config);

  if (gradient.enabled) {
    return colorAtGradient(gradient.stops, ratio);
  }

  const field = resolveGaugeField(plugin, config, element);
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

/** Merge per-element field overrides (units, scale max, etc.) onto gauge config for formatting. */
export function mergeElementFieldConfig(
  gaugeConfig: Record<string, unknown>,
  element: GaugeElement,
): Record<string, unknown> {
  if (element.kind !== 'arc' && element.kind !== 'bar' && element.kind !== 'text') {
    return gaugeConfig;
  }
  const overrides: Record<string, unknown> = { field: element.field };
  if (element.scaleMax != null) overrides.scaleMax = element.scaleMax;
  if (element.units != null) overrides.units = element.units;
  if (element.distanceUnits != null) overrides.distanceUnits = element.distanceUnits;
  if (element.ftp != null) overrides.ftp = element.ftp;
  if (element.maxHr != null) overrides.maxHr = element.maxHr;
  if (element.maxCadence != null) overrides.maxCadence = element.maxCadence;
  if (element.maxSpeedKmh != null) overrides.maxSpeedKmh = element.maxSpeedKmh;
  return { ...gaugeConfig, ...overrides };
}

export function derivedTextForRole(
  role: 'label' | 'value' | 'unit',
  meta: GaugeEditorMeta,
  scaleMax: number,
  ratio: number,
  config?: Record<string, unknown>,
): string {
  if (role === 'label') return meta.label.toUpperCase();
  if (role === 'unit') {
    return meta.formatPreviewUnit?.(scaleMax, ratio, config)
      ?? meta.getUnit?.(config ?? {})
      ?? meta.unit;
  }
  return meta.formatPreviewValue(scaleMax, ratio, config);
}

export function dataSchemaKeys(plugin: GaugePlugin): string[] {
  const layoutKeys = new Set([
    ...Object.keys(barGaugeSchemaProperties),
    'panelOpacity', 'panelBg', 'panelBorder', 'fontScale', 'fontFamily', 'frameShape', 'frameCornerRadius', 'cornerStyle',
    'layout', 'color', 'fillGradient', 'showArcTicks', 'arcTickCount',
    'displayStyle', 'field',
    ...(plugin.id === 'builtin:speedometer' || isDataGaugePlugin(plugin.id) ? ['units'] : []),
    ...(plugin.id === 'builtin:gpsMiniMap' || isDataGaugePlugin(plugin.id)
      ? ['trailColor', 'cursorColor', 'routeScope',
        'showCourseMarkers', 'showCourseStart', 'showCourseFinish',
        'startMarkerStyle', 'finishMarkerStyle', 'startMarkerColor', 'finishMarkerColor',
        'markerScale', 'markerLength', 'markerWidth']
      : []),
  ]);
  return Object.keys(plugin.schema.properties).filter((k) => !layoutKeys.has(k));
}

export const SPEED_UNIT_OPTIONS = [
  { value: 'kmh', label: 'km/h' },
  { value: 'mph', label: 'mph' },
] as const;

export const DISTANCE_UNIT_OPTIONS = [
  { value: 'km', label: 'km / m' },
  { value: 'mi', label: 'mi / ft' },
] as const;

export { FONT_OPTIONS } from '../lib/fonts';
export { fieldLabel };
