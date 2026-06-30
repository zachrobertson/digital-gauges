import type { GaugePlugin } from '@shared/types';
import { appearanceDefaults, appearanceSchemaProperties } from './appearanceSchema';
import { barGaugeDefaults, barGaugeSchemaProperties, resolveArcTickCount, resolveShowArcTicks, resolveShowScaleLabels } from './barGaugeSchema';
import { renderBarGauge, resolveDisplayStyle } from './barGauge';
import { clamp, panelStyleFromConfig } from './common';
import type { BarGaugeLayoutConfig } from './barGaugeSchema';
import { defaultVideoRectForLayout } from './gaugeEditorLayout';
import { fillColorForRatio } from './gaugeGradient';
import { currentUnitPrefs } from '../lib/fieldConfig';

interface Config extends BarGaugeLayoutConfig {
  units: 'kmh' | 'mph';
  color: string;
  maxSpeedKmh: number;
  panelOpacity?: number;
  panelBg?: string;
  panelBorder?: string;
  fontScale?: number;
  fontFamily?: string;
  cornerStyle?: 'rounded' | 'square' | 'pill' | 'circle';
}

export const speedometer: GaugePlugin<Config> = {
  id: 'builtin:speedometer',
  name: 'Speedometer',
  description: 'Big readout of current speed with bar or arc dial.',
  fields: ['speed'],
  defaultRect: defaultVideoRectForLayout(undefined, 1920, 1080, 0.20, 0.04, 0.74),
  defaultConfig: {
    units: 'kmh',
    color: '#3ddc97',
    maxSpeedKmh: 80,
    ...appearanceDefaults,
    ...barGaugeDefaults,
    displayStyle: 'arc',
    textLayout: 'standard',
  },
  schema: {
    type: 'object',
    properties: {
      units: {
        type: 'string',
        title: 'Speed units',
        enum: ['kmh', 'mph'],
        format: 'select',
        default: 'kmh',
        group: 'Data',
      },
      color: { type: 'string', title: 'Accent color', format: 'color', default: '#3ddc97', group: 'Data' },
      maxSpeedKmh: {
        type: 'number',
        title: 'Scale full (km/h)',
        minimum: 10,
        maximum: 200,
        step: 5,
        default: 80,
        group: 'Data',
      },
      ...barGaugeSchemaProperties,
      ...appearanceSchemaProperties,
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const panelStyle = panelStyleFromConfig(config);
    const displayStyle = resolveDisplayStyle(config.displayStyle);

    const speedMs = (frame?.speed as number | undefined) ?? 0;
    // Fall back to the global speed-unit preference when the gauge has no explicit unit.
    const units = config.units ?? currentUnitPrefs().speedUnits;
    const { value, unitLabel } = convertSpeed(speedMs, units);
    const maxDisplay = units === 'mph'
      ? String(Math.round(config.maxSpeedKmh * 0.621371))
      : String(config.maxSpeedKmh);
    const ratio = clamp((speedMs * 3.6) / config.maxSpeedKmh, 0, 1);

    renderBarGauge({
      ctx,
      rect,
      panelStyle,
      label: 'speed',
      valueText: value.toFixed(value < 10 ? 1 : 0),
      unitText: unitLabel,
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
      scaleMaxLabel: maxDisplay,
    });
  },
};

function convertSpeed(ms: number, units: Config['units'] | 'ms'): { value: number; unitLabel: string } {
  if (units === 'mph') return { value: ms * 2.23693629, unitLabel: 'MPH' };
  return { value: ms * 3.6, unitLabel: 'KM/H' };
}
