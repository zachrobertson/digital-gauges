import { useState } from 'react';
import { useProject } from '../../store/project';
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
      <main className="flex-1 min-w-0 flex flex-col bg-[#0c1014]">
        {hasClips ? (
          <>
            <div className="flex-[3] min-h-0 relative flex flex-col">
              <VideoPlayer editable={false} />
              <SyncGaugeHint />
            </div>
            <div className="flex-[2] min-h-0 flex flex-col border-t border-white/[0.07]">
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
