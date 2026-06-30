import type { CourseSettings, GaugeInstance, TelemetryField, TelemetrySource } from '@shared/types';
import { isDataElement } from '@shared/types/gaugeElement';
import { appearanceDefaults } from '../gauges/appearanceSchema';
import { barGaugeDefaults } from '../gauges/barGaugeSchema';
import {
  DATA_GAUGE_PLUGIN_ID,
  defaultConfigForField,
  SCALAR_GAUGE_FIELDS,
} from '../gauges/fieldRegistry';
import {
  DEFAULT_GAUGE_LAYOUT,
  defaultVideoRectForLayout,
  mergeGaugeLayout,
  syncGaugeVideoRectHeight,
} from '../gauges/gaugeEditorLayout';
import {
  defaultRectForGauge,
  layoutTemplateForGauge,
} from '../gauges/dataGauge';
import type { Project, TelemetryTrack } from '@shared/types';
import { firstClipMedia } from '@shared/timeline';
import { allProjectTracks } from './telemetry';
import type { GaugeTemplateFile, GaugeTemplateGaugeSpec } from '@shared/types/gaugeTemplate';
import {
  createElement,
  defaultGaugeElements,
  elementLabel,
  isCompositeGaugeConfig,
} from './gaugeElementFactory';
import { currentUnitPrefs } from './fieldConfig';

const FIT_SOURCE: TelemetrySource = 'fit';

export interface FieldOption {
  field: TelemetryField;
  trackId: string;
  trackLabel: string;
  source: TelemetrySource;
  group: 'fit' | 'derived';
}

export const DERIVED_FIELD_DEPS: Partial<Record<TelemetryField, TelemetryField>> = {
  distanceToFinish: 'distance',
};

export function collectFieldOptions(
  tracks: TelemetryTrack[],
  course?: CourseSettings | null,
): FieldOption[] {
  const out: FieldOption[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    if (track.source !== FIT_SOURCE) continue;
    for (const field of track.fields) {
      if (!SCALAR_GAUGE_FIELDS.includes(field as TelemetryField)) continue;
      const key = `${field}:${track.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        field: field as TelemetryField,
        trackId: track.id,
        trackLabel: track.brand,
        source: track.source,
        group: 'fit',
      });
    }
  }

  const hasFitDistance = tracks.some(
    (t) => t.source === FIT_SOURCE && t.fields.includes('distance'),
  );
  if (hasFitDistance && course?.finishDistanceM != null) {
    out.push({
      field: 'distanceToFinish',
      trackId: 'derived:distanceToFinish',
      trackLabel: 'Course finish',
      source: FIT_SOURCE,
      group: 'derived',
    });
  }

  return out;
}

export function availableFields(tracks: TelemetryTrack[]): Set<string> {
  const f = new Set<string>();
  for (const t of tracks) for (const k of t.fields) f.add(k);
  return f;
}

export function hasGpsData(fields: Set<string>): boolean {
  return fields.has('lat') && fields.has('lon');
}

export function pickDefaultField(fields: Set<string>): TelemetryField | null {
  const priority: TelemetryField[] = ['speed', 'power', 'hr', 'cadence', 'alt', 'temp'];
  for (const f of priority) {
    if (fields.has(f)) return f;
  }
  for (const f of SCALAR_GAUGE_FIELDS) {
    if (fields.has(f)) return f as TelemetryField;
  }
  return null;
}

function elementCanRender(
  element: ReturnType<typeof createElement>,
  fields: Set<string>,
): boolean {
  if (!isDataElement(element)) return true;
  if (element.kind === 'map') return hasGpsData(fields);
  const field = element.field;
  if (fields.has(field)) return true;
  const dep = DERIVED_FIELD_DEPS[field as TelemetryField];
  return dep != null && fields.has(dep);
}

export function createNewGauge(project: Project): GaugeInstance {
  const tracks = allProjectTracks(project);
  const fields = availableFields(tracks);
  const video = firstClipMedia(project);
  const defaultField = pickDefaultField(fields) ?? 'speed';

  const layout = {
    ...DEFAULT_GAUGE_LAYOUT,
    elements: defaultGaugeElements(DEFAULT_GAUGE_LAYOUT.gaugeRect, defaultField),
  };

  // Seed new gauges with the global unit preferences instead of hard-coded metric.
  const prefs = currentUnitPrefs();
  const config: Record<string, unknown> = {
    ...defaultConfigForField(defaultField),
    ...appearanceDefaults,
    ...barGaugeDefaults,
    units: prefs.speedUnits,
    distanceUnits: prefs.distanceUnits,
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    routeScope: 'video',
    layout,
  };

  let rect = defaultRectForGauge(layout, video?.width ?? 1920, video?.height ?? 1080);

  if (video?.width && video?.height) {
    const mergedLayout = mergeGaugeLayout(layout);
    rect = syncGaugeVideoRectHeight(rect, mergedLayout, video.width, video.height);
  }

  const maxZ = project.gauges.reduce((m, g) => Math.max(m, g.z), 0);

  return {
    id: crypto.randomUUID(),
    pluginId: DATA_GAUGE_PLUGIN_ID,
    z: maxZ + 1,
    rect,
    config,
    placed: false,
  };
}

export function gaugeDisplayLabel(gauge: GaugeInstance, mergedConfig: Record<string, unknown>): string {
  const custom = gauge.name?.trim();
  if (custom) return custom;
  if (!isCompositeGaugeConfig(mergedConfig)) return 'Unsupported gauge';
  const layout = mergedConfig.layout as { elements: Parameters<typeof elementLabel>[0][] };
  const visible = layout.elements.filter((e) => e.visible);
  if (visible.length === 0) return 'Empty gauge';
  if (visible.length === 1) return elementLabel(visible[0]!);
  const dataEls = visible.filter(isDataElement);
  if (dataEls.length === 0) return `${visible.length} elements`;
  return dataEls.map((e) => elementLabel(e)).join(' + ');
}

export function gaugeCanRender(
  mergedConfig: Record<string, unknown>,
  fields: Set<string>,
): boolean {
  if (!isCompositeGaugeConfig(mergedConfig)) return false;
  const layout = mergedConfig.layout as { elements: Parameters<typeof elementCanRender>[0][] };
  const dataEls = layout.elements.filter(isDataElement);
  if (dataEls.length === 0) return true;
  return dataEls.some((el) => elementCanRender(el, fields));
}

export function isUnsupportedGaugeConfig(config: Record<string, unknown>): boolean {
  return !isCompositeGaugeConfig(config);
}

export function instanceFromTemplateSpec(
  spec: GaugeTemplateGaugeSpec,
  project: Project,
  z: number,
): GaugeInstance | null {
  const config: Record<string, unknown> = { ...spec.config };
  if (!isCompositeGaugeConfig(config)) return null;

  const video = firstClipMedia(project);
  const layout = mergeGaugeLayout(config.layout as Parameters<typeof mergeGaugeLayout>[0]);
  let rect = spec.rect ?? defaultRectForGauge(layout, video?.width ?? 1920, video?.height ?? 1080);

  if (video?.width && video?.height) {
    rect = syncGaugeVideoRectHeight(rect, layout, video.width, video.height);
  }

  return {
    id: crypto.randomUUID(),
    pluginId: DATA_GAUGE_PLUGIN_ID,
    z,
    rect,
    config,
    placed: false,
    ...(spec.name?.trim() ? { name: spec.name.trim() } : {}),
  };
}

/** Human-readable label when a template spec uses a legacy non-composite format. */
export function templateSpecSkipReason(spec: GaugeTemplateGaugeSpec): string | null {
  if (isCompositeGaugeConfig(spec.config)) return null;
  return gaugeDisplayLabel({} as GaugeInstance, spec.config);
}

export function buildLayoutFromTemplate(
  template: GaugeTemplateFile,
  project: Project,
): { gauges: GaugeInstance[]; skipped: string[] } {
  const specs = template.type === 'layout' ? template.gauges ?? [] : template.gauge ? [template.gauge] : [];
  const baseZ = project.gauges.reduce((m, g) => Math.max(m, g.z), 0);
  const gauges: GaugeInstance[] = [];
  const skipped: string[] = [];
  specs.forEach((spec, i) => {
    const inst = instanceFromTemplateSpec(spec, project, baseZ + i + 1);
    if (inst) {
      gauges.push(inst);
      return;
    }
    const reason = templateSpecSkipReason(spec);
    skipped.push(reason ?? gaugeDisplayLabel({} as GaugeInstance, spec.config));
  });
  return { gauges, skipped };
}

export function specFromGauge(gauge: GaugeInstance, mergedConfig: Record<string, unknown>): GaugeTemplateGaugeSpec {
  const { displayStyle: _ds, field: _f, ...rest } = mergedConfig;
  const name = gauge.name?.trim();
  return {
    config: { ...rest },
    rect: { ...gauge.rect },
    z: gauge.z,
    ...(name ? { name } : {}),
  };
}
