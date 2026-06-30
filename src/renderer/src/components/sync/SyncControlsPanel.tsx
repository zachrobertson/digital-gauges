import { useState } from 'react';
import { useProject } from '../../store/project';
import type { SyncAnchor, TelemetryTrack, TimelineClip } from '@shared/types';
import {
  clipAtGlobalTime,
  clipDurationMs,
  clipInMs,
  globalTimeFromClipLocal,
} from '@shared/timeline';
import {
  effectiveSharedFitOffsetMs,
  fitOffsetSliderRange,
  formatOffsetMs,
  offsetFromSyncPoint,
  SYNC_ANCHOR_LABELS,
  trackOffsetMs,
  videoUtcMs,
} from '@shared/sync';
import { fitSampleTimeAtGlobalMs } from '../../lib/telemetry';
import { clipSyncStatus, clipSyncStatusDisplay } from '../../lib/syncStatus';

const DATA_HUE: Record<string, string> = {
  fit: '#f5a524',
  camera: '#9aa3ad',
};

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

function formatKm(meters: number | null | undefined): string {
  if (meters == null) return '—';
  return `${(meters / 1000).toFixed(2)} km`;
}

function fitTrackDurationMs(track: TelemetryTrack): number {
  if (track.frames.length === 0) return 0;
  return track.frames[track.frames.length - 1]!.offsetMs;
}

interface Props {
  linkLocked: boolean;
  onLinkLockedChange: (locked: boolean) => void;
}

export function SyncControlsPanel({ linkLocked, onLinkLockedChange }: Props) {
  const project = useProject((s) => s.project);
  const clips = project.clips;
  const sharedTracks = project.sharedTracks;
  const selectedClipId = useProject((s) => s.selectedClipId);
  const playhead = useProject((s) => s.playhead);
  const setClipOffset = useProject((s) => s.setClipOffset);
  const setClipTrackAnchor = useProject((s) => s.setClipTrackAnchor);
  const setCourseDistance = useProject((s) => s.setCourseDistance);
  const setCourseMarker = useProject((s) => s.setCourseMarker);
  const clearCourseMarker = useProject((s) => s.clearCourseMarker);

  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [courseOpen, setCourseOpen] = useState(true);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? clips[0] ?? null;
  const selectedClipIndex = selectedClip
    ? clips.findIndex((c) => c.id === selectedClip.id)
    : -1;

  if (!selectedClip || selectedClipIndex < 0) {
    return (
      <aside className="w-72 shrink-0 bg-bg-panel border-l border-white/[0.07] p-3.5 overflow-y-auto">
        <p className="text-xs text-textfaint">Add a clip in Edit mode to begin syncing.</p>
      </aside>
    );
  }

  const utcAvailable = videoUtcMs(selectedClip.media) != null;
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
  const playheadLoc = clipAtGlobalTime(clips, playhead);
  const clipLocalPlayhead = playheadLoc?.clip.id === selectedClip.id
    ? playheadLoc.localMs
    : null;
  const globalFitMs = fitTrack ? fitSampleTimeAtGlobalMs(project, playhead) : null;
  const fitClipLocalMs = clipLocalPlayhead != null
    ? clipLocalPlayhead + clipIn - fitOffset
    : null;

  const offsetRange = fitTrack
    ? fitOffsetSliderRange(
      [...selectedClip.localTracks, ...sharedTracks],
      clipDur,
      { ...selectedClip.localTrackSync, ...selectedClip.sharedTrackSync },
      selectedClip.media,
    )
    : { min: -120_000, max: 120_000 };

  const fitDur = fitTrack ? fitTrackDurationMs(fitTrack) : 0;
  const fitHasDistance = fitTrack?.fields.includes('distance') ?? false;
  const course = project.course;
  const courseLengthM = course?.startDistanceM != null && course?.finishDistanceM != null
    ? course.finishDistanceM - course.startDistanceM
    : null;

  const status = clipSyncStatus(selectedClip, selectedClipIndex, project);
  const statusDisplay = clipSyncStatusDisplay(status);

  const autoAlignUtc = () => {
    if (!fitTrack) return;
    setClipTrackAnchor(selectedClip.id, fitTrack.id, 'utc', fitScope);
  };

  const nudgeOffset = (delta: number) => {
    if (!fitTrack) return;
    setClipOffset(selectedClip.id, fitTrack.id, fitOffset + delta, fitScope);
  };

  const setMarkerAtPlayhead = (field: 'start' | 'finish') => {
    const ok = setCourseMarker(field, playhead);
    if (!ok) {
      alert('Distance unavailable at playhead — ensure FIT track has distance data.');
    }
  };

  const allTracks = [
    ...sharedTracks.map((t) => ({ track: t, scope: 'shared' as const })),
    ...clips.flatMap((c) => c.localTracks.map((t) => ({ track: t, scope: 'local' as const }))),
  ];

  return (
    <aside className="w-72 shrink-0 bg-bg-panel border-l border-white/[0.07] p-3.5 overflow-y-auto flex flex-col gap-3">
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

      {/* Workflow hint */}
      <div className="rounded-[10px] bg-bg border border-white/[0.07] p-3">
        <p className="text-[11.5px] text-textdim leading-relaxed">
          <span className="text-white font-semibold">1.</span> Scrub the video to a moment you can see.{' '}
          <span className="text-white font-semibold">2.</span> Align the FIT data (drag when unlinked, or nudge / set a sync point) until live values match.
        </p>
      </div>

      {/* Link toggle */}
      <div>
        <div className="field-label mb-1.5">Waveform link</div>
        <div className="flex gap-1">
          <button
            type="button"
            className={`flex-1 text-xs py-1.5 rounded-lg border ${linkLocked ? 'border-accent bg-accent/15 text-accent' : 'border-white/[0.07] bg-bg'}`}
            onClick={() => onLinkLockedChange(true)}
          >
            Linked
          </button>
          <button
            type="button"
            className={`flex-1 text-xs py-1.5 rounded-lg border ${!linkLocked ? 'border-accent bg-accent/15 text-accent' : 'border-white/[0.07] bg-bg'}`}
            onClick={() => onLinkLockedChange(false)}
          >
            Unlinked
          </button>
        </div>
        <p className="text-[10px] text-textfaint mt-1.5 leading-relaxed">
          {linkLocked
            ? 'Click waveforms to scrub playhead. FIT drag disabled.'
            : 'Drag the FIT block on waveforms. Playhead stays put on clicks.'}
        </p>
      </div>

      <div className="h-px bg-white/[0.07]" />

      {/* UTC auto-align */}
      <div>
        <div className="field-label mb-2">UTC auto-align</div>
        {fitTrack && utcAvailable ? (
          <button type="button" className="btn-elevated text-xs w-full" onClick={autoAlignUtc}>
            Auto-align via UTC
          </button>
        ) : (
          <div className="rounded-[9px] bg-bg border border-dashed border-white/[0.16] p-3">
            <p className="text-[11px] text-textfaint leading-relaxed">
              {fitTrack
                ? 'Unavailable — this clip has no container timestamp to align to. Use visual sync below.'
                : 'Load a FIT file in Edit mode to align telemetry to the footage.'}
            </p>
          </div>
        )}
      </div>

      {/* Offset controls */}
      {fitTrack && (
        <div className="flex flex-col gap-2.5">
          <div className="field-label">Offset</div>

          <select
            value={fitSync?.anchor ?? 'utc'}
            onChange={(e) => setClipTrackAnchor(
              selectedClip.id,
              fitTrack.id,
              e.target.value as SyncAnchor,
              fitScope,
            )}
            className="select-input text-xs py-1 w-full"
            title="How this track is aligned to the clip"
          >
            {(Object.keys(SYNC_ANCHOR_LABELS) as SyncAnchor[]).map((key) => (
              <option key={key} value={key}>{SYNC_ANCHOR_LABELS[key]}</option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <input
              type="range"
              min={offsetRange.min}
              max={offsetRange.max}
              step={1}
              value={fitOffset}
              onChange={(e) => setClipOffset(
                selectedClip.id,
                fitTrack.id,
                parseInt(e.target.value, 10),
                fitScope,
              )}
              className="flex-1 min-w-0"
            />
            <span className="text-[10px] font-mono text-accent shrink-0">{formatOffsetMs(fitOffset)}</span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              step={1}
              value={fitOffset}
              onChange={(e) => setClipOffset(
                selectedClip.id,
                fitTrack.id,
                parseInt(e.target.value || '0', 10),
                fitScope,
              )}
              className="flex-1 bg-white/5 rounded px-2 py-1 text-xs border border-white/10 text-right font-mono"
              title="Offset in milliseconds"
            />
            <span className="text-[10px] text-white/40 shrink-0">ms</span>
          </div>

          <div className="flex flex-wrap gap-1">
            {[-1000, -100, -50, 50, 100, 1000].map((d) => (
              <button
                key={d}
                type="button"
                className="btn-ghost text-[10px] py-0.5 px-1.5"
                title={`Nudge ${d > 0 ? '+' : ''}${d} ms`}
                onClick={() => nudgeOffset(d)}
              >
                {d > 0 ? '+' : '−'}{Math.abs(d) >= 1000 ? `${Math.abs(d) / 1000}s` : `${Math.abs(d)}ms`}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="btn-ghost text-xs text-accent"
              title="Pin FIT start to the current frame (set sync point)"
              onClick={() => {
                const ph = useProject.getState().playhead;
                const clipLocal = Math.max(0, Math.min(ph - selectedClipStart, clipDur));
                setClipOffset(
                  selectedClip.id,
                  fitTrack.id,
                  offsetFromSyncPoint(clipLocal + clipIn, 0),
                  fitScope,
                );
              }}
            >
              Set sync point @ playhead
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              title="Pin FIT start to the current playhead"
              onClick={() => {
                const ph = useProject.getState().playhead;
                const clipLocal = Math.max(0, Math.min(ph - selectedClipStart, clipDur));
                setClipOffset(
                  selectedClip.id,
                  fitTrack.id,
                  offsetFromSyncPoint(clipLocal + clipIn, 0),
                  fitScope,
                );
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
                setClipOffset(
                  selectedClip.id,
                  fitTrack.id,
                  offsetFromSyncPoint(clipLocal + clipIn, fitDur),
                  fitScope,
                );
              }}
            >
              Pin FIT end to playhead
            </button>
          </div>
        </div>
      )}

      {/* Live readout */}
      <div>
        <div className="field-label mb-1.5">Live readout</div>
        <div className="grid grid-cols-1 gap-1.5 text-[11px] font-mono text-white/50">
          <div className="rounded bg-white/[0.03] px-2 py-1.5">
            <span className="text-white/30">clip </span>
            {clipLocalPlayhead != null ? formatVideoTime(clipLocalPlayhead) : '—'}
          </div>
          <div className="rounded bg-white/[0.03] px-2 py-1.5">
            <span className="text-white/30">fit clip </span>
            {fitClipLocalMs != null && fitClipLocalMs >= 0 ? formatVideoTime(fitClipLocalMs) : '—'}
          </div>
          <div className="rounded bg-white/[0.03] px-2 py-1.5">
            <span className="text-white/30">fit ride </span>
            {globalFitMs != null && globalFitMs >= 0 ? formatVideoTime(globalFitMs) : '—'}
          </div>
        </div>
      </div>

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
                  markerVideoMs={course?.startMarkerVideoMs ?? null}
                  kmValue={course?.startDistanceM != null ? course.startDistanceM / 1000 : ''}
                  onKmChange={(km) => setCourseDistance('start', km == null ? null : km * 1000)}
                  onSetAtPlayhead={() => setMarkerAtPlayhead('start')}
                  onClear={() => clearCourseMarker('start')}
                />
                <CourseMarkerColumn
                  label="Finish"
                  distanceM={course?.finishDistanceM ?? null}
                  markerVideoMs={course?.finishMarkerVideoMs ?? null}
                  kmValue={course?.finishDistanceM != null ? course.finishDistanceM / 1000 : ''}
                  onKmChange={(km) => setCourseDistance('finish', km == null ? null : km * 1000)}
                  onSetAtPlayhead={() => setMarkerAtPlayhead('finish')}
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
    </aside>
  );
}

function CourseMarkerColumn({
  label,
  distanceM,
  markerVideoMs,
  kmValue,
  onKmChange,
  onSetAtPlayhead,
  onClear,
}: {
  label: string;
  distanceM: number | null;
  markerVideoMs: number | null | undefined;
  kmValue: number | '';
  onKmChange: (km: number | null) => void;
  onSetAtPlayhead: () => void;
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
      <button type="button" className="btn-ghost text-xs" onClick={onSetAtPlayhead}>
        Set {label.toLowerCase()} at playhead
      </button>
      {distanceM != null && (
        <div className="text-[10px] text-white/45 font-mono leading-relaxed">
          {label} marker: {formatKm(distanceM)}
          {markerVideoMs != null && ` @ ${formatVideoTime(markerVideoMs)} global`}
        </div>
      )}
      {distanceM != null && (
        <button type="button" className="btn-ghost text-[10px] text-red-300 self-start" onClick={onClear}>
          Clear {label.toLowerCase()}
        </button>
      )}
    </div>
  );
}
