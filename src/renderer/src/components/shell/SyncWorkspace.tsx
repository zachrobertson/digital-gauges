import { useRef, useState } from 'react';
import { useProject } from '../../store/project';
import { useVerticalSplit } from '../../lib/useVerticalSplit';
import { VideoPlayer } from '../player/VideoPlayer';
import { Timeline } from '../timeline/Timeline';
import { ClipList } from '../timeline/ClipList';
import { SyncControlsPanel } from '../sync/SyncControlsPanel';
import { SyncGaugeHint } from '../sync/SyncGaugeHint';

/** Sync page — clips (left) · video + sync strip (center) · controls (right). */
export function SyncWorkspace() {
  const clips = useProject((s) => s.project.clips);
  const hasClips = clips.length > 0;
  const [linkLocked, setLinkLocked] = useState(true);
  const centerRef = useRef<HTMLElement>(null);
  const {
    fraction: videoFraction,
    onDividerPointerDown,
    onDividerPointerMove,
    onDividerPointerUp,
  } = useVerticalSplit(centerRef, { initialFraction: 0.55, minFirstPx: 100, minSecondPx: 220 });

  return (
    <div className="flex h-full min-h-0">
      {/* Left: clip list with sync status */}
      <aside className="w-56 shrink-0 bg-bg-panel border-r border-white/[0.07] p-3.5 overflow-y-auto">
        {hasClips ? (
          <>
            <ClipList showSyncStatus variant="sidebar" />
            <p className="text-[10.5px] text-textfaint mt-2">Select a clip, then align its data in the panel and waveforms.</p>
          </>
        ) : (
          <p className="text-xs text-textfaint">Add a clip in Edit mode to begin syncing.</p>
        )}
      </aside>

      {/* Center: video + sync timeline strip */}
      <main ref={centerRef} className="flex-1 min-w-0 flex flex-col bg-[#0c1014]">
        {hasClips ? (
          <>
            <div
              className="min-h-0 relative flex flex-col"
              style={{ flex: `${videoFraction} 1 0%` }}
            >
              <VideoPlayer editable={false} />
              <SyncGaugeHint />
            </div>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize video preview"
              aria-valuenow={Math.round(videoFraction * 100)}
              className="shrink-0 h-2 bg-white/[0.04] hover:bg-accent/30 active:bg-accent/50 cursor-ns-resize touch-none flex items-center justify-center group"
              onPointerDown={onDividerPointerDown}
              onPointerMove={onDividerPointerMove}
              onPointerUp={onDividerPointerUp}
              onPointerCancel={onDividerPointerUp}
            >
              <div className="w-10 h-0.5 rounded-full bg-white/20 group-hover:bg-accent/80 pointer-events-none" />
            </div>
            <div
              className="min-h-0 flex flex-col overflow-y-auto"
              style={{ flex: `${1 - videoFraction} 1 0%` }}
            >
              <Timeline linkLocked={linkLocked} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-textfaint text-sm">
            Add a clip in Edit mode to begin syncing.
          </div>
        )}
      </main>

      {/* Right: consolidated sync controls */}
      <SyncControlsPanel linkLocked={linkLocked} onLinkLockedChange={setLinkLocked} />
    </div>
  );
}
