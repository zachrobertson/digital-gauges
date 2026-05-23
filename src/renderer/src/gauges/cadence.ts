import type { GaugePlugin } from '@shared/types';
import { appearanceDefaults, appearanceSchemaProperties } from './appearanceSchema';
import { barGaugeDefaults, barGaugeSchemaProperties, resolveArcTickCount, resolveShowArcTicks, resolveShowScaleLabels } from './barGaugeSchema';
import type { BarGaugeLayoutConfig } from './barGaugeSchema';
import { renderBarGauge, resolveDisplayStyle } from './barGauge';
import { clamp, panelStyleFromConfig } from './common';
import { defaultVideoRectForLayout } from './gaugeEditorLayout';
import { fillColorForRatio } from './gaugeGradient';

interface Config extends BarGaugeLayoutConfig {
  color: string;
  maxCadence: number;
  panelOpacity?: number;
  panelBg?: string;
  panelBorder?: string;
  fontScale?: number;
  fontFamily?: string;
  cornerStyle?: 'rounded' | 'square' | 'pill' | 'circle';
}

export const cadence: GaugePlugin<Config> = {
  id: 'builtin:cadence',
  name: 'Cadence',
  description: 'Pedaling cadence with bar or arc dial.',
  fields: ['cadence'],
  defaultRect: defaultVideoRectForLayout(undefined, 1920, 1080, 0.18, 0.66, 0.74),
  defaultConfig: { color: '#10b981', maxCadence: 120, ...appearanceDefaults, ...barGaugeDefaults },
  schema: {
    type: 'object',
    properties: {
      maxCadence: {
        type: 'number',
        title: 'Scale full (rpm)',
        minimum: 60,
        maximum: 200,
        step: 5,
        default: 120,
        group: 'Data',
      },
      color: { type: 'string', title: 'Accent color', format: 'color', default: '#10b981', group: 'Data' },
      ...barGaugeSchemaProperties,
      ...appearanceSchemaProperties,
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const panelStyle = panelStyleFromConfig(config);
    const displayStyle = resolveDisplayStyle(config.displayStyle);
    const rpm = (frame?.cadence as number | undefined) ?? 0;
    const ratio = clamp(rpm / config.maxCadence, 0, 1);

    renderBarGauge({
      ctx,
      rect,
      panelStyle,
      label: 'cadence',
      valueText: rpm > 0 ? rpm.toFixed(0) : '—',
      unitText: 'RPM',
      ratio,
      color: fillColorForRatio(config.fillGradient, ratio, config.color),
      displayStyle,
      textLayout: config.textLayout,
      layout: config.layout,
      fillGradient: config.fillGradient,
      showScaleLabels: resolveShowScaleLabels(config),
      showArcTicks: resolveShowArcTicks(config),
      arcTickCount: resolveArcTickCount(config),
      scaleMinLabel: '0',
      scaleMaxLabel: String(config.maxCadence),
    });
  },
};
