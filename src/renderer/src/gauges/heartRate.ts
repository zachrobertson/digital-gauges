import type { GaugePlugin } from '@shared/types';
import { appearanceDefaults, appearanceSchemaProperties } from './appearanceSchema';
import { barGaugeDefaults, barGaugeSchemaProperties, resolveArcTickCount, resolveShowArcTicks, resolveShowScaleLabels } from './barGaugeSchema';
import type { BarGaugeLayoutConfig } from './barGaugeSchema';
import { renderBarGauge, resolveDisplayStyle } from './barGauge';
import { clamp, panelStyleFromConfig } from './common';
import { defaultVideoRectForLayout } from './gaugeEditorLayout';
import { fillColorForRatio, HR_GRADIENT_PRESET } from './gaugeGradient';

interface Config extends BarGaugeLayoutConfig {
  maxHr: number;
  color: string;
  panelOpacity?: number;
  panelBg?: string;
  panelBorder?: string;
  fontScale?: number;
  fontFamily?: string;
  cornerStyle?: 'rounded' | 'square' | 'pill' | 'circle';
}

export const heartRate: GaugePlugin<Config> = {
  id: 'builtin:hr',
  name: 'Heart Rate',
  description: 'Heart rate readout with bar or arc dial.',
  fields: ['hr'],
  defaultRect: defaultVideoRectForLayout(undefined, 1920, 1080, 0.18, 0.46, 0.74),
  defaultConfig: { maxHr: 190, color: '#ef4444', fillGradient: HR_GRADIENT_PRESET, ...appearanceDefaults, ...barGaugeDefaults },
  schema: {
    type: 'object',
    properties: {
      maxHr: {
        type: 'number',
        title: 'Max HR (bpm)',
        minimum: 120,
        maximum: 220,
        step: 1,
        default: 190,
        group: 'Data',
      },
      color: { type: 'string', title: 'Color', format: 'color', default: '#ef4444', group: 'Data' },
      ...barGaugeSchemaProperties,
      ...appearanceSchemaProperties,
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const panelStyle = panelStyleFromConfig(config);
    const displayStyle = resolveDisplayStyle(config.displayStyle);
    const hr = (frame?.hr as number | undefined) ?? 0;
    const ratio = clamp(hr / config.maxHr, 0, 1);
    const fillColor = hr > 0
      ? fillColorForRatio(config.fillGradient, ratio, config.color)
      : config.color;

    renderBarGauge({
      ctx,
      rect,
      panelStyle,
      label: 'heart rate',
      valueText: hr > 0 ? hr.toFixed(0) : '—',
      unitText: 'BPM',
      ratio,
      color: fillColor,
      displayStyle,
      textLayout: config.textLayout,
      layout: config.layout,
      fillGradient: config.fillGradient,
      showScaleLabels: resolveShowScaleLabels(config),
      showArcTicks: resolveShowArcTicks(config),
      arcTickCount: resolveArcTickCount(config),
      scaleMinLabel: '0',
      scaleMaxLabel: String(config.maxHr),
    });
  },
};

export function hrZoneColor(pct: number): string {
  if (pct < 0.6) return '#6b7280';
  if (pct < 0.7) return '#3b82f6';
  if (pct < 0.8) return '#10b981';
  if (pct < 0.9) return '#f59e0b';
  return '#ef4444';
}
