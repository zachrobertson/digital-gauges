import { useCallback } from 'react';
import { useProject } from '../../store/project';
import { findPluginById } from '../../store/plugins';
import { GaugePicker } from '../editor/GaugePicker';
import { ConfigPanel } from '../editor/ConfigPanel';
import { GaugeStagePreview } from '../editor/GaugeStagePreview';
import { isDataGaugePlugin } from '../../gauges/dataGauge';
import { isUnsupportedGaugeConfig } from '../../lib/gaugeFactory';
import { useGaugeEditorSession } from '../../lib/useGaugeEditorSession';

/** Gauges page — placed list (left) · preview (center) · properties (right). */
export function GaugesWorkspace() {
  const selectedGaugeId = useProject((s) => s.selectedGaugeId);
  const session = useGaugeEditorSession(selectedGaugeId);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-1 min-h-0">
        <aside className="w-60 shrink-0 bg-bg-panel border-r border-white/[0.07] overflow-y-auto p-3">
          <GaugePicker />
        </aside>

        <main className="flex-1 min-w-0 flex flex-col bg-[#0c1014] overflow-hidden relative z-0">
          <GaugeCenterHeader />
          <GaugeCenter session={session} />
        </main>

        <aside className="w-96 shrink-0 bg-bg-panel border-l border-white/[0.07] overflow-y-auto relative z-10 isolate">
          <ConfigPanel
            showPreview={false}
            selectedElementIds={session.selectedElementIds}
            onSelectElements={session.setSelectedElementIds}
          />
        </aside>
      </div>
    </div>
  );
}

function useSelectedGauge() {
  const selectedId = useProject((s) => s.selectedGaugeId);
  const gauge = useProject((s) => (selectedId ? s.project.gauges.find((g) => g.id === selectedId) ?? null : null));
  const updateGauge = useProject((s) => s.updateGauge);
  const plugin = gauge ? findPluginById(gauge.pluginId) : null;
  const merged = gauge && plugin ? { ...plugin.defaultConfig, ...gauge.config } : null;
  return { gauge, plugin, merged, updateGauge };
}

function GaugeCenter({
  session,
}: {
  session: ReturnType<typeof useGaugeEditorSession>;
}) {
  const { gauge, plugin, merged, updateGauge } = useSelectedGauge();
  const onConfigChange = useCallback(
    (patch: Record<string, unknown>) => {
      if (!gauge) return;
      const current = useProject.getState().project.gauges.find((g) => g.id === gauge.id);
      updateGauge(gauge.id, { config: { ...(current?.config ?? gauge.config), ...patch } });
    },
    [gauge, updateGauge],
  );

  if (!gauge || !plugin || !merged) {
    return (
      <div className="flex-1 flex items-center justify-center text-textfaint text-sm">
        Select a gauge on the left, or add one to start designing.
      </div>
    );
  }

  return (
    <GaugeStagePreview
      plugin={plugin}
      gauge={gauge}
      mergedConfig={merged}
      onConfigChange={onConfigChange}
      selectedElementIds={session.selectedElementIds}
      onSelectElements={session.setSelectedElementIds}
      showGrid={session.showGrid}
      onShowGridChange={session.setShowGrid}
      snapEnabled={session.snapEnabled}
      onSnapEnabledChange={session.setSnapEnabled}
      gridSize={session.gridSize}
    />
  );
}

function GaugeCenterHeader() {
  const { gauge, plugin, merged } = useSelectedGauge();
  if (!gauge || !plugin || !merged) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.07]">
        <span className="text-xs text-textfaint">Select a gauge to edit elements and layout.</span>
      </div>
    );
  }
  const unsupported = isDataGaugePlugin(plugin.id) && isUnsupportedGaugeConfig(merged);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.07]">
      {unsupported ? (
        <span className="text-xs text-amber-200/80">Unsupported gauge — recreate to use composite elements.</span>
      ) : (
        <span className="text-xs text-textfaint">
          Shift+click multi-select · Alt+click deep edit · Ctrl+G group · drag to box-select
        </span>
      )}
    </div>
  );
}
