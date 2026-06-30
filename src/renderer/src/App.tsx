import { useEffect } from 'react';
import { TopBar } from './components/shell/TopBar';
import { EditWorkspace } from './components/shell/EditWorkspace';
import { SyncWorkspace } from './components/shell/SyncWorkspace';
import { GaugesWorkspace } from './components/shell/GaugesWorkspace';
import { ExportWorkspace } from './components/shell/ExportWorkspace';
import { ProcessingOverlay } from './components/ProcessingOverlay';
import { useProjectAutosave } from './lib/useProjectAutosave';
import { useSessionRecovery } from './lib/useSessionRecovery';
import { useExport } from './lib/useExport';
import { PreviewVideoProvider } from './lib/PreviewVideoProvider';
import { useProject } from './store/project';
import { usePlugins } from './store/plugins';

export default function App() {
  const setUserPlugins = usePlugins((s) => s.setUserPlugins);
  const mode = useProject((s) => s.workspaceMode);
  const busyMessage = useProject((s) => s.busyMessage);

  // Global hooks hoisted to the app root so they survive workspace switches.
  useProjectAutosave();
  useSessionRecovery();
  const exportApi = useExport();

  useEffect(() => {
    window.api.listUserPlugins().then(setUserPlugins).catch(() => {});
    const off = window.api.onUserPluginsChanged((plugins) => {
      setUserPlugins(plugins);
    });
    return off;
  }, [setUserPlugins]);

  // Escape clears gauge selection — only meaningful while designing gauges.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const { selectedGaugeId, selectGauge, workspaceMode } = useProject.getState();
      if (workspaceMode !== 'gauges' && workspaceMode !== 'edit') return;
      if (!selectedGaugeId) return;
      e.preventDefault();
      selectGauge(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <PreviewVideoProvider>
      <div className="flex flex-col h-full overflow-hidden bg-bg text-white">
        <TopBar />

        <div className="flex-1 min-h-0">
          {mode === 'edit' && <EditWorkspace />}
          {mode === 'sync' && <SyncWorkspace />}
          {mode === 'gauges' && <GaugesWorkspace />}
          {mode === 'export' && <ExportWorkspace exportApi={exportApi} />}
        </div>

        <ProcessingOverlay message={busyMessage} />
      </div>
    </PreviewVideoProvider>
  );
}
