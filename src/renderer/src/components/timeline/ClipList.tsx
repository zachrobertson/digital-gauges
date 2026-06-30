import { useMemo } from 'react';
import { useProject } from '../../store/project';
import { clipDurationMs, clipStartGlobalMs, totalDurationMs } from '@shared/timeline';
import { clipSyncStatus, clipSyncStatusDisplay } from '../../lib/syncStatus';

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  /** Show per-clip sync status pill (Sync workspace). */
  showSyncStatus?: boolean;
  /** Sidebar/panel layout — no outer border, taller clip list. */
  variant?: 'timeline' | 'sidebar' | 'panel';
  /** Allow reordering clips via up/down controls. */
  allowReorder?: boolean;
  /** Allow removing clips from the list. */
  allowRemove?: boolean;
}

/**
 * Ordered clip list — select active clip for sync editing; optional reorder/remove.
 */
export function ClipList({
  showSyncStatus = false,
  variant = 'timeline',
  allowReorder = true,
  allowRemove = true,
}: Props) {
  const project = useProject((s) => s.project);
  const clips = project.clips;
  const selectedClipId = useProject((s) => s.selectedClipId);
  const selectClip = useProject((s) => s.selectClip);
  const removeClip = useProject((s) => s.removeClip);
  const reorderClips = useProject((s) => s.reorderClips);

  const orderedClips = useMemo(
    () => clips
      .map((clip, clipIndex) => ({ clip, clipIndex }))
      .sort((a, b) => clipStartGlobalMs(clips, a.clipIndex) - clipStartGlobalMs(clips, b.clipIndex)),
    [clips],
  );

  if (clips.length === 0) return null;

  const moveClip = (clipIndex: number, dir: -1 | 1) => {
    const next = clipIndex + dir;
    if (next < 0 || next >= clips.length) return;
    const ids = clips.map((c) => c.id);
    [ids[clipIndex], ids[next]] = [ids[next]!, ids[clipIndex]!];
    reorderClips(ids);
  };

  const isCompact = variant === 'sidebar' || variant === 'panel';

  return (
    <div
      className={
        isCompact
          ? 'flex flex-col gap-1.5'
          : 'border-b border-white/5 px-3 py-2 flex flex-col gap-1'
      }
    >
      <div className="flex items-center justify-between">
        <span className="field-label">Clips</span>
        <span className="text-[10px] text-white/40 font-mono">
          {clips.length} clip{clips.length !== 1 ? 's' : ''} · {formatDuration(totalDurationMs(clips))}
        </span>
      </div>
      <div
        className={
          isCompact
            ? 'flex flex-col gap-1.5'
            : 'flex flex-col gap-1 max-h-32 overflow-y-auto'
        }
      >
        {orderedClips.map(({ clip, clipIndex }, displayIndex) => {
          const selected = clip.id === selectedClipId;
          const statusPill = showSyncStatus
            ? clipSyncStatusDisplay(clipSyncStatus(clip, clipIndex, project))
            : null;
          return (
            <div
              key={clip.id}
              className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                selected ? 'bg-accent/15 border border-accent/30' : 'bg-white/[0.03] border border-transparent'
              }`}
            >
              <button
                type="button"
                className="flex-1 text-left min-w-0"
                onClick={() => selectClip(clip.id)}
                title="Select for sync editing"
              >
                <div className="truncate">
                  <span className="text-white/50 mr-1">{displayIndex + 1}.</span>
                  <span className="font-medium">{clip.media.filename}</span>
                  <span className="text-white/40 ml-2 font-mono">{formatDuration(clipDurationMs(clip))}</span>
                </div>
                {statusPill && (
                  <span
                    className="mt-0.5 inline-block px-1.5 py-0.5 rounded text-[9.5px] font-semibold"
                    style={{ background: statusPill.background, color: statusPill.color }}
                  >
                    {statusPill.label}
                  </span>
                )}
              </button>
              {allowReorder && (
                <>
                  <button
                    type="button"
                    className="btn-ghost text-[10px] py-0 px-1 shrink-0"
                    disabled={clipIndex === 0}
                    onClick={() => moveClip(clipIndex, -1)}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-[10px] py-0 px-1 shrink-0"
                    disabled={clipIndex === clips.length - 1}
                    onClick={() => moveClip(clipIndex, 1)}
                    title="Move down"
                  >
                    ↓
                  </button>
                </>
              )}
              {allowRemove && (
                <button
                  type="button"
                  className="btn-ghost text-[10px] text-red-300 py-0 px-1 shrink-0"
                  onClick={() => {
                    if (clips.length === 1) {
                      if (!window.confirm('Remove the only clip?')) return;
                    }
                    removeClip(clip.id);
                  }}
                  title="Remove clip"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
