import { useCallback, useEffect } from 'react';
import type { GaugeInstance, GaugeTemplateFile } from '@shared/types';
import { findPluginById } from '../store/plugins';
import { useProject } from '../store/project';
import { useTemplateStore } from '../store/templates';
import { buildLayoutFromTemplate, specFromGauge } from './gaugeFactory';

export function useGaugeTemplates() {
  const templates = useTemplateStore((s) => s.templates);
  const refresh = useTemplateStore((s) => s.refresh);
  const project = useProject((s) => s.project);
  const addGauge = useProject((s) => s.addGauge);
  const selectGauge = useProject((s) => s.selectGauge);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSingleTemplate = useCallback(async (gauge: GaugeInstance, name: string) => {
    const plugin = findPluginById(gauge.pluginId);
    const merged = { ...plugin?.defaultConfig, ...gauge.config };
    const spec = specFromGauge(gauge, merged);
    const now = new Date().toISOString();
    const file: GaugeTemplateFile = {
      version: 1,
      id: crypto.randomUUID(),
      name,
      type: 'single',
      createdAt: now,
      updatedAt: now,
      gauge: spec,
    };
    await window.api.saveGaugeTemplate(file);
    await refresh();
  }, [refresh]);

  const saveLayoutTemplate = useCallback(async (name: string) => {
    const gauges = [...project.gauges].sort((a, b) => a.z - b.z);
    const specs = gauges.map((g) => {
      const plugin = findPluginById(g.pluginId);
      const merged = { ...plugin?.defaultConfig, ...g.config };
      return specFromGauge(g, merged);
    });
    const now = new Date().toISOString();
    const file: GaugeTemplateFile = {
      version: 1,
      id: crypto.randomUUID(),
      name,
      type: 'layout',
      createdAt: now,
      updatedAt: now,
      gauges: specs,
    };
    await window.api.saveGaugeTemplate(file);
    await refresh();
  }, [project.gauges, refresh]);

  const applyTemplate = useCallback(async (id: string) => {
    const template = await window.api.loadGaugeTemplate(id);
    if (!template) return;
    const { gauges, skipped } = buildLayoutFromTemplate(template, project);
    for (const g of gauges) addGauge(g);
    if (gauges.length > 0) selectGauge(gauges[gauges.length - 1]!.id);
    if (skipped.length > 0) {
      alert(`Skipped unavailable gauge(s): ${skipped.join(', ')}`);
    }
  }, [addGauge, project, selectGauge]);

  const deleteTemplate = useCallback(async (id: string) => {
    await window.api.deleteGaugeTemplate(id);
    await refresh();
  }, [refresh]);

  return {
    templates,
    refresh,
    saveSingleTemplate,
    saveLayoutTemplate,
    applyTemplate,
    deleteTemplate,
  };
}
