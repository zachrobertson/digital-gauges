import type { JSONSchemaProperty } from '@shared/types';

export const FONT_PRESETS = ['Inter', 'JetBrains Mono', 'system-ui'] as const;

/** Shared appearance schema fields for built-in gauges. */
export const appearanceSchemaProperties: Record<string, JSONSchemaProperty> = {
  panelOpacity: {
    type: 'number',
    title: 'Panel opacity',
    minimum: 0,
    maximum: 1,
    step: 0.05,
    default: 0.65,
    group: 'Appearance',
  },
  panelBg: {
    type: 'string',
    title: 'Panel background',
    format: 'color',
    default: '#0b0d10',
    group: 'Appearance',
  },
  panelBorder: {
    type: 'string',
    title: 'Panel border',
    format: 'color',
    default: 'transparent',
    group: 'Appearance',
  },
  fontScale: {
    type: 'number',
    title: 'Font scale',
    minimum: 0.5,
    maximum: 2,
    step: 0.1,
    default: 1,
    group: 'Appearance',
  },
  fontFamily: {
    type: 'string',
    title: 'Font',
    enum: [...FONT_PRESETS],
    format: 'font',
    default: 'Inter',
    group: 'Appearance',
  },
  cornerStyle: {
    type: 'string',
    title: 'Frame shape',
    enum: ['rounded', 'square', 'circle'],
    format: 'select',
    default: 'rounded',
    group: 'Appearance',
  },
};

export const appearanceDefaults = {
  panelOpacity: 0.65,
  panelBg: '#0b0d10',
  panelBorder: 'transparent',
  fontScale: 1,
  fontFamily: 'Inter' as const,
  cornerStyle: 'rounded' as const,
};
