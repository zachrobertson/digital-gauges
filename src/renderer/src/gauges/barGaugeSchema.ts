import type { JSONSchemaProperty } from '@shared/types';
import type { GaugeLayoutConfig } from './gaugeEditorLayout';
import type { FillGradientConfig } from './gaugeGradient';

export type BarGaugeDisplayStyle = 'bar' | 'arc' | 'text';
export type DataGaugeDisplayStyle = BarGaugeDisplayStyle | 'map';
export type BarGaugeTextLayout = 'standard' | 'centered' | 'stacked' | 'minimal';

export const barGaugeSchemaProperties: Record<string, JSONSchemaProperty> = {
  displayStyle: {
    type: 'string',
    title: 'Display style',
    enum: ['bar', 'arc', 'text', 'map'],
    format: 'select',
    default: 'bar',
    group: 'Layout',
    description: 'Bar — progress strip. Arc — dial. Text — readout only. Map — GPS route mini-map.',
  },
  textLayout: {
    type: 'string',
    title: 'Text layout (bar mode)',
    enum: ['standard', 'centered', 'stacked', 'minimal'],
    format: 'select',
    default: 'standard',
    group: 'Layout',
    description: 'Label, value, and unit placement when using bar display.',
  },
  showScaleLabels: {
    type: 'boolean',
    title: 'Show scale labels',
    default: false,
    group: 'Layout',
    description: 'Min/max numbers at the arc dial endpoints (arc mode only).',
  },
  showArcTicks: {
    type: 'boolean',
    title: 'Show arc hash marks',
    default: true,
    group: 'Layout',
    description: 'Radial tick marks along the arc dial (arc mode only).',
  },
  arcTickCount: {
    type: 'number',
    title: 'Arc hash mark count',
    minimum: 2,
    maximum: 32,
    step: 1,
    default: 8,
    group: 'Layout',
    description: 'Number of equal divisions along the arc (arc mode only).',
  },
};

export const barGaugeDefaults = {
  displayStyle: 'bar' as BarGaugeDisplayStyle,
  textLayout: 'standard' as BarGaugeTextLayout,
  showScaleLabels: false,
  showArcTicks: true,
  arcTickCount: 8,
};

export function resolveShowScaleLabels(config: {
  showScaleLabels?: boolean;
  showMax?: boolean;
}): boolean {
  if (config.showScaleLabels != null) return config.showScaleLabels;
  if (config.showMax != null) return config.showMax;
  return false;
}

export const MIN_ARC_TICK_COUNT = 2;
export const MAX_ARC_TICK_COUNT = 32;

export function resolveShowArcTicks(config: { showArcTicks?: boolean }): boolean {
  return config.showArcTicks !== false;
}

export function resolveArcTickCount(config: { arcTickCount?: number }): number {
  const n = Number(config.arcTickCount ?? barGaugeDefaults.arcTickCount);
  if (!Number.isFinite(n)) return barGaugeDefaults.arcTickCount;
  return Math.max(MIN_ARC_TICK_COUNT, Math.min(MAX_ARC_TICK_COUNT, Math.round(n)));
}

export interface BarGaugeLayoutConfig {
  displayStyle?: BarGaugeDisplayStyle;
  textLayout?: BarGaugeTextLayout;
  showScaleLabels?: boolean;
  showArcTicks?: boolean;
  arcTickCount?: number;
  /** @deprecated Use showScaleLabels — kept for older speedometer configs. */
  showMax?: boolean;
  /** Gradual multi-stop fill gradient (min → max along bar/arc). */
  fillGradient?: FillGradientConfig;
  /** Custom absolute layout from the gauge editor (480×270 reference frame). */
  layout?: GaugeLayoutConfig;
}
