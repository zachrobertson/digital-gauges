import type { GaugeTemplateFile, GaugeTemplateGaugeSpec, GaugeTemplateSummary, TelemetryField } from '@shared/types';
import { appearanceDefaults } from '../gauges/appearanceSchema';
import { barGaugeDefaults } from '../gauges/barGaugeSchema';
import { defaultConfigForField } from '../gauges/fieldRegistry';
import { DEFAULT_GAUGE_RECT, DEFAULT_GPS_GAUGE_RECT } from '../gauges/gaugeEditorLayout';
import {
  createArcElement,
  createBarElement,
  createMapElement,
  createTextReadoutElement,
} from './gaugeElementFactory';

const EPOCH = '1970-01-01T00:00:00.000Z';

import type { GaugeElement } from '@shared/types/gaugeElement';

function compositeConfig(elements: GaugeElement[]): Record<string, unknown> {
  return {
    ...appearanceDefaults,
    ...barGaugeDefaults,
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    routeScope: 'video',
    layout: {
      gaugeRect: { ...DEFAULT_GAUGE_RECT },
      elements,
    },
  };
}

function fieldConfig(field: TelemetryField): Record<string, unknown> {
  return {
    ...compositeConfig([createBarElement(DEFAULT_GAUGE_RECT, field)]),
    ...defaultConfigForField(field),
  };
}

function spec(
  config: Record<string, unknown>,
  rect?: GaugeTemplateGaugeSpec['rect'],
): GaugeTemplateGaugeSpec {
  return { config, rect };
}

function single(id: string, name: string, gauge: GaugeTemplateGaugeSpec): GaugeTemplateFile {
  return { version: 1, id, name, type: 'single', createdAt: EPOCH, updatedAt: EPOCH, gauge };
}

/** Bundled starter templates. Always present, can be applied but not deleted. */
export const BUILTIN_TEMPLATES: GaugeTemplateFile[] = [
  single('builtin:speed-bar', 'Speedometer bar', spec(fieldConfig('speed'))),
  single('builtin:speed-arc', 'Speedometer dial', spec({
    ...compositeConfig([createArcElement(DEFAULT_GAUGE_RECT, 'speed')]),
    ...defaultConfigForField('speed'),
  })),
  single('builtin:power-arc', 'Power dial', spec({
    ...compositeConfig([createArcElement(DEFAULT_GAUGE_RECT, 'power')]),
    ...defaultConfigForField('power'),
  })),
  single('builtin:hr-bar', 'Heart rate bar', spec(fieldConfig('hr'))),
  single('builtin:cadence-text', 'Cadence readout', spec({
    ...compositeConfig([createTextReadoutElement(DEFAULT_GAUGE_RECT, 'cadence')]),
    ...defaultConfigForField('cadence'),
  })),
  single('builtin:route-map', 'Route map', spec({
    ...appearanceDefaults,
    ...barGaugeDefaults,
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    routeScope: 'video',
    layout: {
      gaugeRect: { ...DEFAULT_GPS_GAUGE_RECT },
      elements: [createMapElement(DEFAULT_GPS_GAUGE_RECT)],
    },
  })),
  single('builtin:race-hud', 'Race HUD', spec({
    ...appearanceDefaults,
    ...barGaugeDefaults,
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    routeScope: 'video',
    ...defaultConfigForField('speed'),
    layout: {
      gaugeRect: { x: 40, y: 20, w: 400, h: 230 },
      elements: (() => {
        const mapGroup = 'race-hud-map';
        const speedGroup = 'race-hud-speed';
        const powerGroup = 'race-hud-power';
        return [
          { ...createMapElement({ x: 40, y: 20, w: 120, h: 100 }), groupId: mapGroup },
          { ...createBarElement({ x: 40, y: 140, w: 180, h: 80 }, 'speed'), groupId: speedGroup },
          { ...createArcElement({ x: 260, y: 120, w: 180, h: 130 }, 'power'), groupId: powerGroup },
        ];
      })(),
    },
  }, { x: 0.04, y: 0.05, w: 0.92, h: 0.9 })),
];

const BUILTIN_BY_ID = new Map(BUILTIN_TEMPLATES.map((t) => [t.id, t]));

export function isBuiltinTemplateId(id: string): boolean {
  return BUILTIN_BY_ID.has(id);
}

export function builtinTemplate(id: string): GaugeTemplateFile | undefined {
  return BUILTIN_BY_ID.get(id);
}

export function builtinTemplateSummaries(): (GaugeTemplateSummary & { source: 'builtin' })[] {
  return BUILTIN_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    updatedAt: t.updatedAt,
    filePath: '',
    source: 'builtin',
  }));
}
