import { useProject, type WorkspaceMode } from '../../store/project';

const TABS: { mode: WorkspaceMode; label: string }[] = [
  { mode: 'edit', label: 'Edit' },
  { mode: 'sync', label: 'Sync' },
  { mode: 'gauges', label: 'Gauges' },
  { mode: 'export', label: 'Export' },
];

export const MODE_HINTS: Record<WorkspaceMode, string> = {
  edit: 'Trim, split & arrange clips',
  sync: 'Align telemetry to footage',
  gauges: 'Design overlays',
  export: 'Render the final video',
};

/** Workspace mode navigation — pill group, one focused workspace at a time. */
export function ModeTabs() {
  const mode = useProject((s) => s.workspaceMode);
  const setMode = useProject((s) => s.setWorkspaceMode);

  return (
    <div className="tabgroup" role="tablist" aria-label="Workspace">
      {TABS.map((t) => (
        <button
          key={t.mode}
          type="button"
          role="tab"
          aria-selected={mode === t.mode}
          className={mode === t.mode ? 'tab-active' : 'tab'}
          onClick={() => setMode(t.mode)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
