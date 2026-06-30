import type { JSONSchemaProperty } from '@shared/types';
import { DEFAULT_FONT_FAMILY, FONT_FAMILY_VALUES } from '../lib/fonts';

/** Selectable gauge fonts — single source of truth lives in lib/fonts.ts. */
export const FONT_PRESETS = FONT_FAMILY_VALUES;

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
    default: DEFAULT_FONT_FAMILY,
    group: 'Appearance',
  },
  frameShape: {
    type: 'string',
    title: 'Frame shape',
    enum: ['rectangle', 'ellipse'],
    format: 'select',
    default: 'rectangle',
    group: 'Appearance',
  },
  frameCornerRadius: {
    type: 'number',
    title: 'Corner radius',
    minimum: 0,
    maximum: 240,
    step: 1,
    default: 0,
    group: 'Appearance',
    description: 'Rounded corners for rectangle frames (layout pixels).',
  },
};

export const appearanceDefaults = {
  panelOpacity: 0.65,
  panelBg: '#0b0d10',
  panelBorder: 'transparent',
  fontScale: 1,
  fontFamily: DEFAULT_FONT_FAMILY,
  frameShape: 'rectangle' as const,
  frameCornerRadius: 0,
};
