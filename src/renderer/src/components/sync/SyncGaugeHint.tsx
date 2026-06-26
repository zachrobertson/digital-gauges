import { useProject } from '../../store/project';

/** Non-blocking banner when no gauges are placed on the video overlay. */
export function SyncGaugeHint() {
  const gauges = useProject((s) => s.project.gauges);
  const setWorkspaceMode = useProject((s) => s.setWorkspaceMode);

  const placedCount = gauges.filter((g) => g.placed !== false).length;
  if (placedCount > 0) return null;

  return (
    <div className="absolute bottom-3 left-3 right-3 z-10 pointer-events-none">
      <div className="pointer-events-auto rounded-lg border border-white/10 bg-black/70 backdrop-blur-sm px-3 py-2.5 flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-white/70 leading-relaxed">
          No gauges placed yet — values shown in the sync panel and waveforms.
          Place gauges in Edit or Gauges to preview the HUD while syncing.
        </p>
        <button
          type="button"
          className="btn-elevated text-xs shrink-0"
          onClick={() => setWorkspaceMode('gauges')}
        >
          Open Gauges
        </button>
      </div>
    </div>
  );
}
