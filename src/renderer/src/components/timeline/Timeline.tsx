import { memo, useMemo } from 'react';
import { useProject } from '../../store/project';
import type { Project, TelemetryTrack, TimelineClip } from '@shared/types';
import {
  clipAtGlobalTime,
  clipBoundariesMs,
  clipDurationMs,
  clipEndGlobalMs,
  clipStartGlobalMs,
  globalTimeFromClipLocal,
  projectDurationMs,
  totalDurationMs,
} from '@shared/timeline';
import {
  effectiveSharedFitOffsetMs,
  trackOffsetMs,
} from '@shared/sync';
import { SyncViewer } from './SyncViewer';
import { fitSampleTimeAtGlobalMs } from '../../lib/telemetry';
import { SyncMapPreview } from '../sync/SyncMapPreview';

function formatVideoTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Playhead-only bar — isolated so track rows / inputs are not re-rendered every frame. */
function SyncPlayheadBar({
  clips,
  selectedClip,
  fitTrackId,
}: {
  clips: TimelineClip[];
  selectedClip: TimelineClip | null;
  fitTrackId?: string;
}) {
  const playhead = useProject((s) => s.playhead);
  const globalDur = projectDurationMs(clips, useProject.getState().project.overlays);
  const playheadLoc = clipAtGlobalTime(clips, playhead);
  const project = useProject((s) => s.project);
  const globalFitMs = fitTrackId ? fitSampleTimeAtGlobalMs(project, playhead) : null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 text-xs sticky top-0 bg-bg-panel/95 backdrop-blur-sm z-10 pointer-events-none">
      <span className="field-label">Sync</span>
      <span className="text-white/40">
        global {(playhead / 1000).toFixed(2)}s / {(globalDur / 1000).toFixed(2)}s
      </span>
      {playheadLoc && (
        <span className="text-white/30">
          · clip {playheadLoc.clipIndex + 1} local {(playheadLoc.localMs / 1000).toFixed(2)}s
        </span>
      )}
      {globalFitMs != null && globalFitMs >= 0 && (
        <span className="text-accent/80" title="Continuous FIT ride time at playhead">
          · FIT ride {formatVideoTime(globalFitMs)}
        </span>
      )}
      {selectedClip?.media.creationTime && (
        <span className="text-white/30 ml-auto font-mono" title="MP4 creation_time (UTC)">
          clip UTC {selectedClip.media.creationTime.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')}
        </span>
      )}
    </div>
  );
}

/** Global ruler playhead marker — playhead subscription isolated here. Scrubbable. */
function GlobalTimelineRuler({ clips }: { clips: TimelineClip[] }) {
  const playhead = useProject((s) => s.playhead);
  const setPlayhead = useProject((s) => s.setPlayhead);
  const setPlaying = useProject((s) => s.setPlaying);
  const overlays = useProject((s) => s.project.overlays);
  const globalDur = projectDurationMs(clips, overlays);
  const selectedClipId = useProject((s) => s.selectedClipId);
  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? clips[0] ?? null;

  const scrubFrom = (clientX: number, el: HTMLElement) => {
    if (globalDur <= 0) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setPlaying(false);
    setPlayhead(Math.round(ratio * globalDur));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubFrom(e.clientX, e.currentTarget);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    scrubFrom(e.clientX, e.currentTarget);
  };

  return (
    <div className="px-3 py-2 border-b border-white/5">
      <div className="text-[10px] text-white/40 mb-1">Global timeline · click or drag to scrub</div>
      <div
        className="relative h-4 bg-white/[0.03] rounded overflow-hidden cursor-ew-resize touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        {clips.map((clip, i) => {
          const start = clipStartGlobalMs(clips, i);
          const end = clipEndGlobalMs(clips, i);
          const left = globalDur > 0 ? (start / globalDur) * 100 : 0;
          const width = globalDur > 0 ? ((end - start) / globalDur) * 100 : 0;
          const isSelected = clip.id === selectedClip?.id;
          return (
            <div
              key={clip.id}
              className={`absolute top-0 h-full border-r border-black/30 ${
                isSelected ? 'bg-accent/25' : 'bg-white/[0.06]'
              }`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${clip.media.filename} (${formatVideoTime(clip.media.durationMs)})`}
            />
          );
        })}
        {globalDur > 0 && (
          <div
            className="absolute top-0 w-0.5 h-full bg-amber-400 z-10 pointer-events-none"
            style={{ left: `${(playhead / globalDur) * 100}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-[9px] text-white/30 font-mono mt-0.5">
        <span>0:00</span>
        <span>{formatVideoTime(globalDur)}</span>
      </div>
    </div>
  );
}

const SyncViewerPanel = memo(function SyncViewerPanel({
  project,
  selectedClip,
  selectedClipIndex,
  fitTrack,
  fitOffset,
  fitScope,
  clipDur,
  linkLocked,
}: {
  project: Project;
  selectedClip: TimelineClip;
  selectedClipIndex: number;
  fitTrack: TelemetryTrack;
  fitOffset: number;
  fitScope: 'local' | 'shared';
  clipDur: number;
  linkLocked: boolean;
}) {
  const playhead = useProject((s) => s.playhead);
  const setClipOffset = useProject((s) => s.setClipOffset);
  const playheadLoc = clipAtGlobalTime(project.clips, playhead);
  const clipLocalPlayhead = playheadLoc?.clip.id === selectedClip.id
    ? playheadLoc.localMs
    : null;
  const syncTracksForViewer = [...selectedClip.localTracks, ...project.sharedTracks];
  const syncMapForViewer = { ...selectedClip.localTrackSync, ...selectedClip.sharedTrackSync };
  const totalDur = projectDurationMs(project.clips, project.overlays);
  const boundaries = clipBoundariesMs(project.clips);
  const selectedClipStartMs = globalTimeFromClipLocal(project.clips, selectedClipIndex, 0);

  return (
    <SyncViewer
      fitTrack={fitTrack}
      fitOffsetMs={fitOffset}
      clipDurationMs={clipDur}
      clipLocalPlayheadMs={clipLocalPlayhead}
      globalPlayheadMs={playhead}
      clipMedia={selectedClip.media}
      syncTracks={syncTracksForViewer}
      syncMap={syncMapForViewer}
      project={project}
      selectedClip={selectedClip}
      selectedClipIndex={selectedClipIndex}
      selectedClipStartMs={selectedClipStartMs}
      totalDurationMs={totalDur}
      clipBoundariesMs={boundaries}
      linkLocked={linkLocked}
      onOffsetChange={(ms) => setClipOffset(selectedClip.id, fitTrack.id, ms, fitScope)}
    />
  );
});

interface TimelineProps {
  linkLocked: boolean;
}

/**
 * Sync timeline strip — global ruler, optional GPS map, and waveform viewer.
 */
export function Timeline({ linkLocked }: TimelineProps) {
  const project = useProject((s) => s.project);
  const selectedClipId = useProject((s) => s.selectedClipId);

  const selectedClip = useMemo(() => {
    const id = selectedClipId ?? project.clips[0]?.id;
    return project.clips.find((c) => c.id === id) ?? project.clips[0] ?? null;
  }, [project.clips, selectedClipId]);

  if (project.clips.length === 0) return null;

  const clipDur = selectedClip ? clipDurationMs(selectedClip) : 0;
  const selectedClipIndex = selectedClip
    ? project.clips.findIndex((c) => c.id === selectedClip.id)
    : -1;

  const localFit = selectedClip?.localTracks.find((t) => t.source === 'fit');
  const sharedFit = project.sharedTracks.find((t) => t.source === 'fit');
  const fitTrack = localFit ?? sharedFit;
  const fitScope = localFit ? 'local' : 'shared';
  const fitOffset = fitTrack && selectedClip && selectedClipIndex >= 0
    ? (fitScope === 'shared'
      ? effectiveSharedFitOffsetMs(project.clips, selectedClipIndex, fitTrack.id)
      : trackOffsetMs(selectedClip.localTrackSync, fitTrack.id))
    : 0;

  return (
    <div className="panel border-t flex flex-col flex-1 min-h-[340px] overflow-x-hidden">
      <SyncPlayheadBar clips={project.clips} selectedClip={selectedClip} fitTrackId={fitTrack?.id} />
      <GlobalTimelineRuler clips={project.clips} />
      <SyncMapPreview />
      {fitTrack && selectedClip && selectedClipIndex >= 0 ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <SyncViewerPanel
            project={project}
            selectedClip={selectedClip}
            selectedClipIndex={selectedClipIndex}
            fitTrack={fitTrack}
            fitOffset={fitOffset}
            fitScope={fitScope}
            clipDur={clipDur}
            linkLocked={linkLocked}
          />
        </div>
      ) : (
        <div className="px-3 py-6 text-xs text-white/40 text-center">
          No FIT track — load a FIT file in Edit mode to align telemetry.
        </div>
      )}
    </div>
  );
}
