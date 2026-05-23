import type { GaugeInstance, TelemetryField, TelemetrySource } from '@shared/types';
import { appearanceDefaults } from '../gauges/appearanceSchema';
import { barGaugeDefaults } from '../gauges/barGaugeSchema';
import {
  DATA_GAUGE_PLUGIN_ID,
  defaultConfigForField,
  SCALAR_GAUGE_FIELDS,
} from '../gauges/fieldRegistry';
import {
  defaultLayoutForTemplate,
  defaultVideoRectForLayout,
  mergeGaugeLayout,
  syncGaugeVideoRectHeight,
} from '../gauges/gaugeEditorLayout';
import {
  defaultRectForDisplayStyle,
  layoutTemplateForGauge,
} from '../gauges/dataGauge';
import type { Project } from '@shared/types';
import type { GaugeTemplateFile, GaugeTemplateGaugeSpec } from '@shared/types/gaugeTemplate';

const FIT_SOURCE: TelemetrySource = 'fit';
const CAMERA_SOURCES: TelemetrySource[] = ['gopro', 'insta360', 'dji', 'sony', 'camm'];

export interface FieldOption {
  field: TelemetryField;
  trackId: string;
  trackLabel: string;
  source: TelemetrySource;
  group: 'fit' | 'camera';
}

export function collectFieldOptions(tracks: Project['tracks']): FieldOption[] {
  const out: FieldOption[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const group = track.source === FIT_SOURCE ? 'fit' as const : 'camera' as const;
    if (group === 'camera' && !CAMERA_SOURCES.includes(track.source)) continue;
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
        group,
      });
    }
  }
  return out;
}

export function availableFields(tracks: Project['tracks']): Set<string> {
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

export function createNewGauge(project: Project): GaugeInstance {
  const fields = availableFields(project.tracks);
  const hasGps = hasGpsData(fields);
  const defaultField = pickDefaultField(fields);
  const displayStyle = defaultField ? 'bar' as const : hasGps ? 'map' as const : 'bar' as const;
  const field = defaultField ?? 'speed';

  const config: Record<string, unknown> = {
    field,
    ...defaultConfigForField(field),
    ...appearanceDefaults,
    ...barGaugeDefaults,
    displayStyle,
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    routeScope: 'video',
    layout: defaultLayoutForTemplate(displayStyle === 'map' ? 'gps' : 'telemetry'),
  };

  let rect = defaultRectForDisplayStyle(
    displayStyle,
    project.video?.width ?? 1920,
    project.video?.height ?? 1080,
  );

  if (project.video?.width && project.video?.height) {
    const template = layoutTemplateForGauge(DATA_GAUGE_PLUGIN_ID, config);
    const layout = mergeGaugeLayout(config.layout as Parameters<typeof mergeGaugeLayout>[0], template);
    const panelShape = (config.cornerStyle as 'rounded' | 'square' | 'pill' | 'circle') ?? 'rounded';
    rect = syncGaugeVideoRectHeight(rect, layout, project.video.width, project.video.height, panelShape);
  }

  const maxZ = project.gauges.reduce((m, g) => Math.max(m, g.z), 0);

  return {
    id: crypto.randomUUID(),
    pluginId: DATA_GAUGE_PLUGIN_ID,
    z: maxZ + 1,
    rect,
    config,
  };
}

export function gaugeDisplayLabel(gauge: GaugeInstance, mergedConfig: Record<string, unknown>): string {
  const displayStyle = mergedConfig.displayStyle ?? 'bar';
  if (displayStyle === 'map') return 'Map';
  const field = (mergedConfig.field as string | undefined) ?? 'speed';
  const kind = String(displayStyle).charAt(0).toUpperCase() + String(displayStyle).slice(1);
  return `${field} · ${kind}`;
}

export function gaugeCanRender(
  mergedConfig: Record<string, unknown>,
  fields: Set<string>,
): boolean {
  const displayStyle = mergedConfig.displayStyle ?? 'bar';
  if (displayStyle === 'map') return hasGpsData(fields);
  const field = mergedConfig.field as string | undefined;
  return !!field && fields.has(field);
}

export function instanceFromTemplateSpec(
  spec: GaugeTemplateGaugeSpec,
  project: Project,
  z: number,
): GaugeInstance | null {
  const fields = availableFields(project.tracks);
  const config: Record<string, unknown> = {
    ...spec.config,
    displayStyle: spec.displayStyle,
    ...(spec.field ? { field: spec.field } : {}),
  };
  if (!gaugeCanRender(config, fields)) return null;

  let rect = spec.rect ?? defaultRectForDisplayStyle(
    spec.displayStyle,
    project.video?.width ?? 1920,
    project.video?.height ?? 1080,
  );

  if (project.video?.width && project.video?.height) {
    const template = layoutTemplateForGauge(DATA_GAUGE_PLUGIN_ID, config);
    const layout = mergeGaugeLayout(config.layout as Parameters<typeof mergeGaugeLayout>[0], template);
    const panelShape = (config.cornerStyle as 'rounded' | 'square' | 'pill' | 'circle') ?? 'rounded';
    rect = syncGaugeVideoRectHeight(rect, layout, project.video.width, project.video.height, panelShape);
  }

  return {
    id: crypto.randomUUID(),
    pluginId: DATA_GAUGE_PLUGIN_ID,
    z,
    rect,
    config,
  };
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
    if (inst) gauges.push(inst);
    else skipped.push(spec.field ?? spec.displayStyle);
  });
  return { gauges, skipped };
}

export function specFromGauge(gauge: GaugeInstance, mergedConfig: Record<string, unknown>): GaugeTemplateGaugeSpec {
  return {
    displayStyle: (mergedConfig.displayStyle ?? 'bar') as GaugeTemplateGaugeSpec['displayStyle'],
    field: mergedConfig.field as TelemetryField | undefined,
    config: { ...mergedConfig },
    rect: { ...gauge.rect },
    z: gauge.z,
  };
}
