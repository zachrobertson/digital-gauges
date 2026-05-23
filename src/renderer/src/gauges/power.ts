import type { GaugePlugin } from '@shared/types';
import { appearanceDefaults, appearanceSchemaProperties } from './appearanceSchema';
import { barGaugeDefaults, barGaugeSchemaProperties, resolveArcTickCount, resolveShowArcTicks, resolveShowScaleLabels } from './barGaugeSchema';
import type { BarGaugeLayoutConfig } from './barGaugeSchema';
import { renderBarGauge, resolveDisplayStyle } from './barGauge';
import { clamp, panelStyleFromConfig } from './common';
import { defaultVideoRectForLayout } from './gaugeEditorLayout';
import { fillColorForRatio, POWER_GRADIENT_PRESET } from './gaugeGradient';

interface Config extends BarGaugeLayoutConfig {
  ftp: number;
  color: string;
  panelOpacity?: number;
  panelBg?: string;
  panelBorder?: string;
  fontScale?: number;
  fontFamily?: string;
  cornerStyle?: 'rounded' | 'square' | 'pill' | 'circle';
}

export const power: GaugePlugin<Config> = {
  id: 'builtin:power',
  name: 'Power (W)',
  description: 'Current power output with bar or arc dial, colored by FTP zones.',
  fields: ['power'],
  defaultRect: defaultVideoRectForLayout(undefined, 1920, 1080, 0.18, 0.26, 0.74),
  defaultConfig: { ftp: 250, color: '#f59e0b', fillGradient: POWER_GRADIENT_PRESET, ...appearanceDefaults, ...barGaugeDefaults },
  schema: {
    type: 'object',
    properties: {
      ftp: {
        type: 'number',
        title: 'FTP (W)',
        minimum: 50,
        maximum: 600,
        step: 5,
        default: 250,
        group: 'Data',
      },
      color: {
        type: 'string',
        title: 'Default color',
        format: 'color',
        default: '#f59e0b',
        group: 'Data',
      },
      ...barGaugeSchemaProperties,
      ...appearanceSchemaProperties,
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const panelStyle = panelStyleFromConfig(config);
    const displayStyle = resolveDisplayStyle(config.displayStyle);
    const watts = (frame?.power as number | undefined) ?? 0;
    const ratio = clamp(watts / (config.ftp * 1.5), 0, 1);
    const zoneColor = fillColorForRatio(config.fillGradient, ratio, powerZoneColor(watts, config.ftp) ?? config.color);
    const maxScale = Math.round(config.ftp * 1.5);

    renderBarGauge({
      ctx,
      rect,
      panelStyle,
      label: 'power',
      valueText: watts.toFixed(0),
      unitText: 'W',
      ratio,
      color: zoneColor,
      displayStyle,
      textLayout: config.textLayout,
      layout: config.layout,
      fillGradient: config.fillGradient,
      showScaleLabels: resolveShowScaleLabels(config),
      showArcTicks: resolveShowArcTicks(config),
      arcTickCount: resolveArcTickCount(config),
      scaleMinLabel: '0',
      scaleMaxLabel: String(maxScale),
    });
  },
};

export function powerZoneColor(w: number, ftp: number): string {
  const pct = w / ftp;
  if (pct < 0.55) return '#6b7280';
  if (pct < 0.75) return '#3b82f6';
  if (pct < 0.90) return '#10b981';
  if (pct < 1.05) return '#f59e0b';
  if (pct < 1.20) return '#ef4444';
  return '#a855f7';
}
