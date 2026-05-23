import { useProject } from '../../store/project';
import type { SyncAnchor } from '@shared/types';
import {
  formatOffsetMs,
  SYNC_ANCHOR_LABELS,
  trackOffsetMs,
} from '@shared/sync';
import { SyncViewer } from './SyncViewer';

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

/**
 * Sync timeline.
 *
 * Offset semantics (per FIT track):
 *   At video time V, sample FIT at local time (V − offsetMs).
 *   offsetMs is the video timestamp where FIT t=0 begins — drag the FIT
 *   row in the manual sync viewer to slide it.
 */
export function Timeline() {
  const project = useProject((s) => s.project);
  const setOffset = useProject((s) => s.setOffset);
  const setTrackAnchor = useProject((s) => s.setTrackAnchor);
  const removeTrack = useProject((s) => s.removeTrack);
  const playhead = useProject((s) => s.playhead);
  const setCourseDistance = useProject((s) => s.setCourseDistance);
  const setCourseMarker = useProject((s) => s.setCourseMarker);
  const clearCourseMarker = useProject((s) => s.clearCourseMarker);

  if (!project.video) return null;

  const videoDur = project.video.durationMs;
  const course = project.course;

  const fitTrack = project.tracks.find((t) => t.source === 'fit');
  const fitHasDistance = fitTrack?.fields.includes('distance') ?? false;

  const courseLengthM = course?.startDistanceM != null && course?.finishDistanceM != null
    ? course.finishDistanceM - course.startDistanceM
    : null;

  const setMarkerAtPlayhead = (field: 'start' | 'finish') => {
    const ok = setCourseMarker(field, playhead);
    if (!ok) {
      alert('Distance unavailable at playhead — ensure FIT track has distance data.');
    }
  };

  return (
    <div className="panel border-t flex flex-col max-h-[42vh] overflow-y-auto">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 text-xs sticky top-0 bg-bg-panel z-10">
        <span className="field-label">Sync</span>
        <span className="text-white/40">
          playhead {(playhead / 1000).toFixed(2)}s / {(videoDur / 1000).toFixed(2)}s
        </span>
        {project.video.creationTime && (
          <span className="text-white/30 ml-auto font-mono" title="MP4 creation_time (UTC)">
            video UTC {project.video.creationTime.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')}
          </span>
        )}
      </div>

      <div className="flex flex-col">
        {project.tracks.map((t) => {
          const sync = project.trackSync[t.id];
          const offset = trackOffsetMs(project.trackSync, t.id);
          const isFit = t.source === 'fit';

          return (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2 border-b border-white/5">
              <div className="w-44 truncate text-sm">
                <span className="font-medium">{t.brand}</span>
                <div className="text-[10px] text-white/40 uppercase tracking-wider">
                  {t.source} · {t.fields.join(' · ')}
                </div>
              </div>

              {isFit ? (
                <>
                  <select
                    value={sync?.anchor ?? 'utc'}
                    onChange={(e) => setTrackAnchor(t.id, e.target.value as SyncAnchor)}
                    className="select-input text-xs py-1"
                    title="How this track is aligned to the video"
                  >
                    {(Object.keys(SYNC_ANCHOR_LABELS) as SyncAnchor[]).map((key) => (
                      <option key={key} value={key}>{SYNC_ANCHOR_LABELS[key]}</option>
                    ))}
                  </select>

                  <div
                    className="flex-1 text-right text-[10px] font-mono text-accent"
                    title={`${offset} ms`}
                  >
                    {formatOffsetMs(offset)}
                  </div>
                  <input
                    type="number"
                    step={1}
                    value={offset}
                    onChange={(e) => setOffset(t.id, parseInt(e.target.value || '0', 10))}
                    className="w-20 bg-white/5 rounded px-2 py-1 text-xs border border-white/10 text-right font-mono"
                    title="Offset in milliseconds"
                  />
                  <span className="text-[10px] text-white/40 w-4">ms</span>
                </>
              ) : (
                <div className="flex-1 text-xs text-white/30 italic">
                  Camera track — fixed at video t=0
                </div>
              )}

              <button
                className="btn-ghost text-xs text-red-300"
                onClick={() => removeTrack(t.id)}
                title="Remove track"
              >
                ✕
              </button>
            </div>
          );
        })}

        {project.tracks.length === 0 && (
          <div className="px-3 py-6 text-xs text-white/40 text-center">
            No telemetry yet — load a video or FIT file to extract data.
          </div>
        )}
      </div>

      {fitHasDistance && (
        <div className="border-b border-white/5 px-3 py-3 flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/70">Course</div>

          <div className="grid grid-cols-2 gap-3">
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

      {fitTrack && (
        <SyncViewer
          project={project}
          fitTrack={fitTrack}
          fitOffsetMs={trackOffsetMs(project.trackSync, fitTrack.id)}
          videoDurationMs={videoDur}
          playheadMs={playhead}
          onOffsetChange={(ms) => setOffset(fitTrack.id, ms)}
        />
      )}
    </div>
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
          {markerVideoMs != null && ` @ ${formatVideoTime(markerVideoMs)}`}
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
