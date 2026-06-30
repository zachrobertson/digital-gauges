import { useMemo } from 'react';
import type { GaugeInstance } from '@shared/types';
import { useProject } from '../../store/project';
import { findPluginById } from '../../store/plugins';
import { createNewGauge, gaugeDisplayLabel, isUnsupportedGaugeConfig } from '../../lib/gaugeFactory';
import { useGaugeTemplates } from '../../lib/useGaugeTemplates';
import { useNamePrompt } from '../../lib/useNamePrompt';
import { isDataGaugePlugin } from '../../gauges/dataGauge';
import { NamePromptDialog } from '../NamePromptDialog';

export function GaugePicker() {
  const project = useProject((s) => s.project);
  const selectedId = useProject((s) => s.selectedGaugeId);
  const addGauge = useProject((s) => s.addGauge);
  const updateGauge = useProject((s) => s.updateGauge);
  const removeGauge = useProject((s) => s.removeGauge);
  const selectGauge = useProject((s) => s.selectGauge);
  const { templates, applyTemplate, deleteTemplate, saveLayoutTemplate, refresh } = useGaugeTemplates();
  const { state: namePrompt, prompt, close: closeNamePrompt } = useNamePrompt();

  const sortedGauges = useMemo(
    () => [...project.gauges].sort((a, b) => a.z - b.z),
    [project.gauges],
  );

  const onNewGauge = () => {
    const gauge = createNewGauge(project);
    addGauge(gauge);
  };

  const onSaveLayout = async () => {
    const name = await prompt({
      title: 'Save layout preset',
      label: 'Preset name',
      placeholder: 'My gauge layout',
      confirmLabel: 'Save',
    });
    if (!name) return;
    await saveLayoutTemplate(name);
  };

  const onRenameGauge = async (gauge: GaugeInstance, currentLabel: string) => {
    const name = await prompt({
      title: 'Rename gauge',
      label: 'Name',
      defaultValue: gauge.name ?? currentLabel,
      confirmLabel: 'Save',
      dismissOnBackdropClick: false,
    });
    if (!name) return;
    updateGauge(gauge.id, { name });
  };

  return (
    <>
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <button type="button" className="btn-primary w-full" onClick={onNewGauge}>
          New gauge
        </button>
        {project.gauges.length > 0 && (
          <button type="button" className="btn-ghost text-xs w-full" onClick={() => void onSaveLayout()}>
            Save layout as preset…
          </button>
        )}
      </div>

      {sortedGauges.some((g) => {
        const plugin = findPluginById(g.pluginId);
        const merged = { ...plugin?.defaultConfig, ...g.config };
        return isDataGaugePlugin(g.pluginId) && isUnsupportedGaugeConfig(merged);
      }) && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-100/90 leading-relaxed">
          One or more gauges use a pre-v4 format without composite elements. Remove and recreate them to edit or export correctly.
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="field-label">Configured gauges</h3>
        {sortedGauges.length === 0 ? (
          <p className="text-xs text-white/40">No gauges yet. Click New gauge to add one, then place it on the video in the Edit tab.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sortedGauges.map((g) => {
              const plugin = findPluginById(g.pluginId);
              const merged = { ...plugin?.defaultConfig, ...g.config };
              const unsupported = isDataGaugePlugin(g.pluginId) && isUnsupportedGaugeConfig(merged);
              const label = isDataGaugePlugin(g.pluginId)
                ? gaugeDisplayLabel(g, merged)
                : (plugin?.name ?? g.pluginId);
              return (
                <li key={g.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => selectGauge(g.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      void onRenameGauge(g, label);
                    }}
                    title="Click to select · Double-click to rename"
                    className={`flex-1 text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                      selectedId === g.id
                        ? 'border-accent/60 bg-accent/10 text-white'
                        : unsupported
                          ? 'border-amber-500/30 bg-amber-500/5 text-amber-100/80 hover:bg-amber-500/10'
                          : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
                    }`}
                  >
                    {label}
                    {unsupported && <span className="block text-[10px] text-amber-200/60 mt-0.5">Unsupported — recreate</span>}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-[10px] text-red-300 px-2"
                    onClick={() => removeGauge(g.id)}
                    title="Delete gauge"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="field-label">Saved templates</h3>
          <button
            type="button"
            className="btn-ghost text-[10px] shrink-0"
            onClick={() => void window.api.importGaugeTemplate().then(() => refresh())}
          >
            Import…
          </button>
        </div>
        {templates.length > 0 && (
          <ul className="flex flex-col gap-1">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex-1 text-left rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                  onClick={() => void applyTemplate(t.id)}
                  title={`Apply ${t.type} template`}
                >
                  <span className="font-medium text-white/90">{t.name}</span>
                  <span className="ml-2 text-white/40 uppercase text-[10px]">{t.type}</span>
                </button>
                <button
                  type="button"
                  className="btn-ghost text-[10px] text-red-300 px-2"
                  onClick={() => void deleteTemplate(t.id)}
                  title="Delete template"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
    <NamePromptDialog
      open={namePrompt.open}
      title={namePrompt.title}
      label={namePrompt.label}
      placeholder={namePrompt.placeholder}
      defaultValue={namePrompt.defaultValue}
      confirmLabel={namePrompt.confirmLabel}
      dismissOnBackdropClick={namePrompt.dismissOnBackdropClick}
      onConfirm={(value) => closeNamePrompt(value)}
      onCancel={() => closeNamePrompt(null)}
    />
    </>
  );
}
