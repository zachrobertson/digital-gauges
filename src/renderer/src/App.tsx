import { useEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { VideoPlayer } from './components/player/VideoPlayer';
import { Timeline } from './components/timeline/Timeline';
import { GaugePicker } from './components/editor/GaugePicker';
import { ConfigPanel } from './components/editor/ConfigPanel';
import { UserPluginPickerDialog } from './components/UserPluginPickerDialog';
import { useProjectAutosave } from './lib/useProjectAutosave';
import { useSessionRecovery } from './lib/useSessionRecovery';
import { useProject } from './store/project';
import { usePlugins } from './store/plugins';
import type { GaugePlugin } from '@shared/types';

export default function App() {
  const setUserPlugins = usePlugins((s) => s.setUserPlugins);

  useProjectAutosave();
  useSessionRecovery();

  useEffect(() => {
    window.api.listUserPlugins().then(setUserPlugins).catch(() => {});
    const off = window.api.onUserPluginsChanged((plugins) => {
      setUserPlugins(plugins);
    });
    return off;
  }, [setUserPlugins]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const { selectedGaugeId, selectGauge } = useProject.getState();
      if (!selectedGaugeId) return;
      e.preventDefault();
      selectGauge(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg text-white">
      <Toolbar />

      <div className="flex flex-1 min-h-0">
        <aside className="w-72 panel border-r border-white/5 overflow-y-auto p-3">
          <GaugePicker />
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          <VideoPlayer />
          <Timeline />
        </main>

        <aside className="w-80 panel border-l border-white/5 overflow-y-auto">
          <ConfigPanel />
          <UserPluginsFooter />
        </aside>
      </div>
    </div>
  );
}

function UserPluginsFooter() {
  const project = useProject((s) => s.project);
  const addGauge = useProject((s) => s.addGauge);
  const user = usePlugins((s) => s.user);
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadedPlugins = user.flatMap((u) => (u.plugin ? [u.plugin] : []));

  const addPluginGauge = (plugin: GaugePlugin) => {
    const maxZ = project.gauges.reduce((m, g) => Math.max(m, g.z), 0);
    addGauge({
      id: crypto.randomUUID(),
      pluginId: plugin.id,
      z: maxZ + 1,
      rect: { ...plugin.defaultRect },
      config: { ...plugin.defaultConfig },
    });
    setPickerOpen(false);
  };

  const onAddUserPlugin = () => {
    if (loadedPlugins.length === 0) {
      alert('No user gauge plugins loaded. Drop a *.gauge.tsx file into the DigitalGauges folder.');
      return;
    }
    if (loadedPlugins.length === 1) {
      addPluginGauge(loadedPlugins[0]!);
      return;
    }
    setPickerOpen(true);
  };

  return (
    <>
      <div className="border-t border-white/5 p-3 flex flex-col gap-2">
        <span className="field-label">User gauge plugins</span>
        <p className="text-xs text-white/40">
          Drop `*.gauge.tsx` files into the DigitalGauges folder; they hot-reload as you save.
        </p>
        <button
          className="btn-ghost text-xs"
          onClick={() => void window.api.openUserPluginsFolder()}
        >
          Open plugins folder…
        </button>
        <button
          className="btn-ghost text-xs"
          onClick={onAddUserPlugin}
        >
          Add user plugin gauge…
        </button>
      </div>
      <UserPluginPickerDialog
        open={pickerOpen}
        plugins={loadedPlugins}
        onConfirm={addPluginGauge}
        onCancel={() => setPickerOpen(false)}
      />
    </>
  );
}
