import { useRef, useState } from 'react';
import { useProject } from '../../store/project';
import type { SyncAnchor, TelemetryTrack, TimelineClip } from '@shared/types';
import {
  clipDurationMs,
  clipInMs,
  globalTimeFromClipLocal,
} from '@shared/timeline';
import {
  effectiveSharedFitOffsetMs,
  offsetFromSyncPoint,
  SYNC_ANCHOR_LABELS,
  trackOffsetMs,
} from '@shared/sync';
import { clipSyncStatus, clipSyncStatusDisplay } from '../../lib/syncStatus';
import { ClipList } from '../timeline/ClipList';

const DATA_HUE: Record<string, string> = {
  fit: '#f5a524',
  camera: '#9aa3ad',
};

function formatKm(meters: number | null | undefined): string {
  if (meters == null) return '—';
  return `${(meters / 1000).toFixed(2)} km`;
}

function fitTrackDurationMs(track: TelemetryTrack): number {
  if (track.frames.length === 0) return 0;
  return track.frames[track.frames.length - 1]!.offsetMs;
}

export function SyncControlsPanel() {
  const project = useProject((s) => s.project);
  const clips = project.clips;
  const sharedTracks = project.sharedTracks;
  const selectedClipId = useProject((s) => s.selectedClipId);
  const setClipOffset = useProject((s) => s.setClipOffset);
  const setClipTrackAnchor = useProject((s) => s.setClipTrackAnchor);
  const setCourseDistance = useProject((s) => s.setCourseDistance);
  const clearCourseMarker = useProject((s) => s.clearCourseMarker);

  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [courseOpen, setCourseOpen] = useState(true);
  const manualOffsetCacheRef = useRef(new Map<string, number>());

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? clips[0] ?? null;
  const selectedClipIndex = selectedClip
    ? clips.findIndex((c) => c.id === selectedClip.id)
    : -1;

  if (!selectedClip || selectedClipIndex < 0) {
    return (
      <aside className="w-72 shrink-0 bg-bg-panel border-l border-white/[0.07] relative z-10 isolate flex flex-col min-h-0">
        <p className="text-xs text-textfaint p-3.5">Add a clip in Edit mode to begin syncing.</p>
      </aside>
    );
  }

  const localFit = selectedClip.localTracks.find((t) => t.source === 'fit');
  const sharedFit = sharedTracks.find((t) => t.source === 'fit');
  const fitTrack = localFit ?? sharedFit;
  const fitScope: 'local' | 'shared' = localFit ? 'local' : 'shared';
  const fitSync = fitTrack
    ? (fitScope === 'local'
      ? selectedClip.localTrackSync[fitTrack.id]
      : selectedClip.sharedTrackSync[fitTrack.id])
    : undefined;

  const fitOffset = fitTrack
    ? (fitScope === 'shared'
      ? effectiveSharedFitOffsetMs(clips, selectedClipIndex, fitTrack.id)
      : trackOffsetMs(selectedClip.localTrackSync, fitTrack.id))
    : 0;

  const clipDur = clipDurationMs(selectedClip);
  // Trim in-point: FIT is sampled against source time (clipIn + clip-local ms),
  // so every clip-local ↔ FIT mapping below must add clipIn to stay aligned with
  // the gauge overlay on trimmed clips (no-op when the clip is untrimmed).
  const clipIn = clipInMs(selectedClip);
  const selectedClipStart = globalTimeFromClipLocal(clips, selectedClipIndex, 0);

  const fitDur = fitTrack ? fitTrackDurationMs(fitTrack) : 0;
  const fitHasDistance = fitTrack?.fields.includes('distance') ?? false;
  const course = project.course;
  const courseLengthM = course?.startDistanceM != null && course?.finishDistanceM != null
    ? course.finishDistanceM - course.startDistanceM
    : null;

  const status = clipSyncStatus(selectedClip, selectedClipIndex, project);
  const statusDisplay = clipSyncStatusDisplay(status);

  const syncCacheKey = fitTrack ? `${selectedClip.id}:${fitTrack.id}:${fitScope}` : '';
  const sharedFitSync = fitScope === 'shared' && fitTrack
    ? clips[0]?.sharedTrackSync[fitTrack.id]
    : undefined;
  const currentAnchor = fitScope === 'shared'
    ? (sharedFitSync?.anchor ?? fitSync?.anchor ?? 'utc')
    : (fitSync?.anchor ?? 'utc');

  const cacheManualOffset = (ms: number) => {
    if (syncCacheKey) manualOffsetCacheRef.current.set(syncCacheKey, ms);
  };

  const handleAnchorChange = (anchor: SyncAnchor) => {
    if (!fitTrack) return;
    if (currentAnchor === 'manual') cacheManualOffset(fitOffset);
    setClipTrackAnchor(selectedClip.id, fitTrack.id, anchor, fitScope);
    if (anchor === 'manual') {
      const cached = manualOffsetCacheRef.current.get(syncCacheKey);
      if (cached != null) {
        setClipOffset(selectedClip.id, fitTrack.id, cached, fitScope);
      }
    }
  };

  const allTracks = [
    ...sharedTracks.map((t) => ({ track: t, scope: 'shared' as const })),
    ...clips.flatMap((c) => c.localTracks.map((t) => ({ track: t, scope: 'local' as const }))),
  ];

  return (
    <aside className="w-72 shrink-0 bg-bg-panel border-l border-white/[0.07] relative z-10 isolate flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-3">
      {/* Status */}
      <div>
        <div className="field-label mb-1.5">Sync status</div>
        <span
          className="inline-block px-2 py-0.5 rounded text-[10.5px] font-semibold"
          style={{ background: statusDisplay.background, color: statusDisplay.color }}
        >
          {statusDisplay.label}
        </span>
      </div>

      {/* Offset controls */}
      {fitTrack && (
        <div className="flex flex-col gap-2.5">
          <div className="field-label">Offset</div>

          <select
            value={currentAnchor}
            onChange={(e) => handleAnchorChange(e.target.value as SyncAnchor)}
            className="select-input text-xs py-1 w-full"
            title="How this track is aligned to the clip"
          >
            {(Object.keys(SYNC_ANCHOR_LABELS) as SyncAnchor[]).map((key) => (
              <option key={key} value={key}>{SYNC_ANCHOR_LABELS[key]}</option>
            ))}
          </select>

          {currentAnchor === 'manual' && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step={1}
                value={fitOffset}
                onChange={(e) => {
                  const ms = parseInt(e.target.value || '0', 10);
                  setClipOffset(selectedClip.id, fitTrack.id, ms, fitScope);
                  cacheManualOffset(ms);
                }}
                className="numeric-input-editable flex-1 bg-white/5 rounded px-2 py-1 text-xs border border-white/10 text-right font-mono"
                title="Offset in milliseconds"
              />
              <span className="text-[10px] text-white/40 shrink-0">ms</span>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="btn-ghost text-xs"
              title="Pin FIT start to the current playhead"
              onClick={() => {
                const ph = useProject.getState().playhead;
                const clipLocal = Math.max(0, Math.min(ph - selectedClipStart, clipDur));
                const ms = offsetFromSyncPoint(clipLocal + clipIn, 0);
                setClipOffset(selectedClip.id, fitTrack.id, ms, fitScope);
                cacheManualOffset(ms);
              }}
            >
              Pin FIT start to playhead
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              title="Pin FIT end to the current playhead"
              onClick={() => {
                const ph = useProject.getState().playhead;
                const clipLocal = Math.max(0, Math.min(ph - selectedClipStart, clipDur));
                const ms = offsetFromSyncPoint(clipLocal + clipIn, fitDur);
                setClipOffset(selectedClip.id, fitTrack.id, ms, fitScope);
                cacheManualOffset(ms);
              }}
            >
              Pin FIT end to playhead
            </button>
          </div>
        </div>
      )}

      {/* Course markers */}
      {fitHasDistance && (
        <div>
          <button
            type="button"
            className="field-label flex items-center gap-1 w-full text-left"
            onClick={() => setCourseOpen((o) => !o)}
          >
            <span>Course</span>
            <span className="text-white/30 text-[10px]">{courseOpen ? '▾' : '▸'}</span>
          </button>
          {courseOpen && (
            <div className="mt-2 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <CourseMarkerColumn
                  label="Start"
                  distanceM={course?.startDistanceM ?? null}
                  kmValue={course?.startDistanceM != null ? course.startDistanceM / 1000 : ''}
                  onKmChange={(km) => setCourseDistance('start', km == null ? null : km * 1000)}
                  onClear={() => clearCourseMarker('start')}
                />
                <CourseMarkerColumn
                  label="Finish"
                  distanceM={course?.finishDistanceM ?? null}
                  kmValue={course?.finishDistanceM != null ? course.finishDistanceM / 1000 : ''}
                  onKmChange={(km) => setCourseDistance('finish', km == null ? null : km * 1000)}
                  onClear={() => clearCourseMarker('finish')}
                />
              </div>
              <div className="text-xs text-white/50">
                Course length: {courseLengthM != null ? formatKm(courseLengthM) : '—'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sources summary */}
      <div>
        <button
          type="button"
          className="field-label flex items-center gap-1 w-full text-left"
          onClick={() => setSourcesOpen((o) => !o)}
        >
          <span>Sources</span>
          <span className="text-white/30 text-[10px]">{sourcesOpen ? '▾' : '▸'}</span>
        </button>
        {sourcesOpen && (
          <div className="mt-2 flex flex-col gap-1.5">
            {allTracks.map(({ track, scope }) => {
              const hasGps = track.fields.includes('lat') && track.fields.includes('lon');
              return (
                <div
                  key={`${scope}:${track.id}`}
                  className="rounded-[8px] p-2 bg-bg-elev border border-white/[0.07] text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: track.source === 'fit' ? DATA_HUE.fit : DATA_HUE.camera }}
                    />
                    <span className="font-semibold truncate">{track.brand}</span>
                    <span className="text-white/40 text-[10px] shrink-0">
                      {scope === 'shared' ? 'shared' : 'local'}
                    </span>
                  </div>
                  {track.source !== 'fit' && (
                    <span
                      className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold"
                      style={{
                        background: hasGps ? 'rgba(61,220,151,0.14)' : 'rgba(245,177,74,0.12)',
                        color: hasGps ? '#3ddc97' : '#f5b14a',
                      }}
                    >
                      {hasGps ? 'GPS' : 'No GPS'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {clips.length > 0 && (
        <>
          <div className="h-px bg-white/[0.07]" />
          <ClipList showSyncStatus allowReorder={false} allowRemove={false} variant="panel" />
        </>
      )}
      </div>
    </aside>
  );
}

function CourseMarkerColumn({
  label,
  distanceM,
  kmValue,
  onKmChange,
  onClear,
}: {
  label: string;
  distanceM: number | null;
  kmValue: number | '';
  onKmChange: (km: number | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border border-white/10 rounded-md p-2">
      <div className="text-xs font-semibold text-white/80">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={0.01}
          value={kmValue}
          placeholder="km"
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onKmChange(null);
              return;
            }
            const parsed = Number(raw);
            if (!Number.isNaN(parsed)) onKmChange(parsed);
          }}
          className="flex-1 min-w-0 bg-white/5 rounded px-2 py-1 text-xs border border-white/10 font-mono"
        />
        <span className="text-xs text-white/40 shrink-0">km</span>
      </div>
      {distanceM != null && (
        <button type="button" className="btn-ghost text-[10px] text-red-300 self-start" onClick={onClear}>
          Clear {label.toLowerCase()}
        </button>
      )}
    </div>
  );
}
