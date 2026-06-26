import { useCallback } from 'react';
import { useProject } from '../../store/project';
import { findPluginById } from '../../store/plugins';
import type { JSONSchema, JSONSchemaProperty, GaugeInstance, GaugePlugin } from '@shared/types';
import { FONT_PRESETS } from '../../gauges/appearanceSchema';
import { supportsGaugeEditor } from '../../gauges/gaugeEditorAdapter';
import { isDataGaugePlugin } from '../../gauges/dataGauge';
import { useGaugeTemplates } from '../../lib/useGaugeTemplates';
import { useNamePrompt } from '../../lib/useNamePrompt';
import { NamePromptDialog } from '../NamePromptDialog';
import { GaugeEditor } from './GaugeEditor';
import { ColorInput } from './ColorInput';

/**
 * Config panel for the selected gauge. Bar/arc gauges use the interactive
 * GaugeEditor; other plugins fall back to JSON Schema-driven fields.
 */
export function ConfigPanel({
  showPreview = true,
  selectedElementIds,
  onSelectElements,
}: {
  showPreview?: boolean;
  selectedElementIds?: string[];
  onSelectElements?: (ids: string[]) => void;
} = {}) {
  const selectedId = useProject((s) => s.selectedGaugeId);
  const gauge = useProject((s) =>
    selectedId ? s.project.gauges.find((g) => g.id === selectedId) : null,
  );
  const updateGauge = useProject((s) => s.updateGauge);
  const removeGauge = useProject((s) => s.removeGauge);
  const { saveSingleTemplate } = useGaugeTemplates();
  const { state: namePrompt, prompt, close: closeNamePrompt } = useNamePrompt();

  const onSaveTemplate = useCallback(async () => {
    if (!gauge) return;
    const name = await prompt({
      title: 'Save gauge template',
      label: 'Template name',
      placeholder: 'My speed gauge',
      confirmLabel: 'Save',
    });
    if (!name) return;
    await saveSingleTemplate(gauge, name);
  }, [gauge, prompt, saveSingleTemplate]);

  if (!gauge) {
    return (
      <>
        <div className="p-4 text-xs text-white/40">
          Select a gauge to configure it.
        </div>
        <NamePromptDialog
          open={namePrompt.open}
          title={namePrompt.title}
          label={namePrompt.label}
          placeholder={namePrompt.placeholder}
          defaultValue={namePrompt.defaultValue}
          confirmLabel={namePrompt.confirmLabel}
          onConfirm={(value) => closeNamePrompt(value)}
          onCancel={() => closeNamePrompt(null)}
        />
      </>
    );
  }

  const plugin = findPluginById(gauge.pluginId);
  if (!plugin) {
    return <div className="p-4 text-xs text-red-300">Plugin not found: {gauge.pluginId}</div>;
  }

  return (
    <>
    <ConfigPanelBody
      gauge={gauge}
      plugin={plugin}
      updateGauge={updateGauge}
      removeGauge={removeGauge}
      showPreview={showPreview}
      selectedElementIds={selectedElementIds}
      onSelectElements={onSelectElements}
      onSaveTemplate={isDataGaugePlugin(gauge.pluginId) ? () => void onSaveTemplate() : undefined}
    />
    <NamePromptDialog
      open={namePrompt.open}
      title={namePrompt.title}
      label={namePrompt.label}
      placeholder={namePrompt.placeholder}
      defaultValue={namePrompt.defaultValue}
      confirmLabel={namePrompt.confirmLabel}
      onConfirm={(value) => closeNamePrompt(value)}
      onCancel={() => closeNamePrompt(null)}
    />
    </>
  );
}

function ConfigPanelBody({
  gauge,
  plugin,
  updateGauge,
  removeGauge,
  onSaveTemplate,
  showPreview = true,
  selectedElementIds,
  onSelectElements,
}: {
  gauge: GaugeInstance;
  plugin: GaugePlugin;
  updateGauge: (id: string, patch: Partial<GaugeInstance>) => void;
  removeGauge: (id: string) => void;
  onSaveTemplate?: () => void;
  showPreview?: boolean;
  selectedElementIds?: string[];
  onSelectElements?: (ids: string[]) => void;
}) {
  const merged = { ...plugin.defaultConfig, ...gauge.config };

  const onConfigChange = useCallback(
    (patch: Record<string, unknown>) => {
      const current = useProject.getState().project.gauges.find((g) => g.id === gauge.id);
      updateGauge(gauge.id, { config: { ...(current?.config ?? gauge.config), ...patch } });
    },
    [gauge.id, gauge.config, updateGauge],
  );
  const onRectChange = useCallback(
    (rect: typeof gauge.rect) => updateGauge(gauge.id, { rect }),
    [gauge.id, updateGauge],
  );

  if (supportsGaugeEditor(plugin, merged)) {
    return (
      <GaugeEditor
        plugin={plugin}
        gauge={gauge}
        mergedConfig={merged}
        onConfigChange={onConfigChange}
        onRectChange={onRectChange}
        onRemove={() => removeGauge(gauge.id)}
        onSaveTemplate={onSaveTemplate}
        showPreview={showPreview}
        selectedElementIds={selectedElementIds}
        onSelectElements={onSelectElements}
        renderDataField={(key, prop, value, onChange) => (
          <Field key={key} name={key} prop={prop} value={value} onChange={onChange} />
        )}
      />
    );
  }

  const groups = groupProperties(plugin.schema.properties);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="text-sm font-semibold">{plugin.name}</div>
        <div className="text-xs text-white/40">{plugin.description}</div>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map(({ name, entries }) => (
          <div key={name ?? '__default'} className="flex flex-col gap-3">
            {name && <div className="field-label text-[10px] uppercase tracking-wider">{name}</div>}
            {entries.map(([key, prop]) => (
              <Field
                key={key}
                name={key}
                prop={prop}
                value={merged[key]}
                onChange={(v) => updateGauge(gauge.id, { config: { ...gauge.config, [key]: v } })}
              />
            ))}
          </div>
        ))}
      </div>

      <hr className="border-white/10" />
      <PositionRow
        label="Position & Size"
        rect={gauge.rect}
        onChange={(rect) => updateGauge(gauge.id, { rect })}
      />

      <button
        className="mt-4 btn-ghost text-red-300 hover:text-red-200"
        onClick={() => removeGauge(gauge.id)}
      >
        Remove gauge
      </button>
    </div>
  );
}

function groupProperties(properties: Record<string, JSONSchemaProperty>) {
  const grouped = new Map<string | null, [string, JSONSchemaProperty][]>();
  for (const [key, prop] of Object.entries(properties)) {
    const groupName = prop.group ?? null;
    const list = grouped.get(groupName) ?? [];
    list.push([key, prop]);
    grouped.set(groupName, list);
  }

  const result: { name: string | null; entries: [string, JSONSchemaProperty][] }[] = [];
  const ungrouped = grouped.get(null);
  if (ungrouped?.length) result.push({ name: null, entries: ungrouped });

  for (const [name, entries] of grouped) {
    if (name) result.push({ name, entries });
  }
  return result;
}

interface FieldProps {
  name: string;
  prop: JSONSchemaProperty;
  value: unknown;
  onChange(v: unknown): void;
}

function Field({ name, prop, value, onChange }: FieldProps) {
  const title = prop.title ?? name;
  const v = value ?? prop.default;
  const hint = prop.description ? (
    <p className="text-[10px] text-white/35 leading-snug">{prop.description}</p>
  ) : null;

  if (prop.type === 'string' && prop.format === 'font') {
    const options = prop.enum?.length ? prop.enum.map(String) : [...FONT_PRESETS];
    return (
      <div className="relative flex flex-col gap-1">
        <label className="field-label">{title}</label>
        {hint}
        <select className="select-input" value={String(v ?? options[0])} onChange={(e) => onChange(e.target.value)}>
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    );
  }

  if (prop.enum || prop.format === 'select') {
    const options = prop.enum ?? [];
    return (
      <div className="relative flex flex-col gap-1">
        <label className="field-label">{title}</label>
        {hint}
        <select className="select-input" value={String(v ?? '')} onChange={(e) => onChange(coerce(prop.type, e.target.value))}>
          {options.map((opt) => (
            <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
          ))}
        </select>
      </div>
    );
  }

  if (prop.type === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <label className="field-label">{title}</label>
        <input type="checkbox" checked={Boolean(v)} onChange={(e) => onChange(e.target.checked)} />
      </div>
    );
  }

  if (prop.type === 'number' || prop.type === 'integer') {
    const min = prop.minimum ?? 0;
    const max = prop.maximum ?? 100;
    const step = prop.step ?? (prop.type === 'integer' ? 1 : 0.1);
    const num = Number(v ?? 0);

    if (prop.format === 'number') {
      return (
        <div className="flex flex-col gap-1">
          <label className="field-label">{title}</label>
          <input type="number" min={min} max={max} step={step} value={num}
            onChange={(e) => onChange(parseFloat(e.target.value || '0'))}
            className="w-full bg-white/5 rounded-md px-2 py-1 text-sm border border-white/10 font-mono" />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        <label className="field-label">{title}</label>
        {hint}
        <input type="number" min={min} max={max} step={step} value={num}
          onChange={(e) => onChange(parseFloat(e.target.value || '0'))}
          className="w-full bg-white/5 rounded-md px-2 py-1 text-sm border border-white/10 font-mono" />
      </div>
    );
  }

  if (prop.type === 'string' && prop.format === 'color') {
    return (
      <ColorInput
        label={title}
        value={String(v ?? '#000000')}
        onChange={(color) => onChange(color)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="field-label">{title}</label>
      <input type="text" className="bg-white/5 rounded-md px-2 py-1 text-sm border border-white/10"
        value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function coerce(type: JSONSchemaProperty['type'], v: string): unknown {
  switch (type) {
    case 'number': return parseFloat(v);
    case 'integer': return parseInt(v, 10);
    case 'boolean': return v === 'true';
    default: return v;
  }
}

function PositionRow({ label, rect, onChange }: {
  label: string;
  rect: { x: number; y: number; w: number; h: number };
  onChange: (rect: { x: number; y: number; w: number; h: number }) => void;
}) {
  const num = (v: number) => (v * 100).toFixed(1);
  return (
    <div className="flex flex-col gap-2">
      <label className="field-label">{label}</label>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Num label="x %" value={num(rect.x)} onChange={(v) => onChange({ ...rect, x: parseFloat(v) / 100 })} />
        <Num label="y %" value={num(rect.y)} onChange={(v) => onChange({ ...rect, y: parseFloat(v) / 100 })} />
        <Num label="w %" value={num(rect.w)} onChange={(v) => onChange({ ...rect, w: parseFloat(v) / 100 })} />
        <Num label="h %" value={num(rect.h)} onChange={(v) => onChange({ ...rect, h: parseFloat(v) / 100 })} />
      </div>
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-10 text-white/50">{label}</span>
      <input className="w-full bg-white/5 rounded px-2 py-1 border border-white/10"
        value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
