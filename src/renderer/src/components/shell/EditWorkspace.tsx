import { useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../../store/project';
import { findPluginById } from '../../store/plugins';
import { useMediaImport } from '../../lib/useMediaImport';
import { gaugeDisplayLabel, isUnsupportedGaugeConfig } from '../../lib/gaugeFactory';
import { isDataGaugePlugin } from '../../gauges/dataGauge';
import { VideoPlayer } from '../player/VideoPlayer';
import { localMediaUrl } from '../../lib/paths';
import {
  clipDurationMs,
  clipInMs,
  clipOutMs,
  clipStartGlobalMs,
  projectDurationMs,
} from '@shared/timeline';
import type { TimelineClip, VideoOverlayClip } from '@shared/types';
import { formatOffsetMs, videoUtcMs } from '@shared/sync';

function fmtClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Edit page — gauge placement + preview + clip inspector over a linear NLE timeline. */
export function EditWorkspace() {
  const clips = useProject((s) => s.project.clips);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-1 min-h-0">
        <GaugePlacementSidebar />
        <main className="flex-1 min-w-0 flex flex-col bg-[#0c1014]">
          {clips.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-textfaint text-sm">
              Add a clip to start editing.
            </div>
          ) : (
            <VideoPlayer editable />
          )}
        </main>
        <ClipInspector />
      </div>
      <EditTimeline />
    </div>
  );
}

/**
 * Lists the gauges configured in the Gauges tab and lets you place them onto the
 * video. Placed gauges render in the live overlay and can be dragged on the
 * footage; unplaced ("configured") gauges stay off the video.
 */
function GaugePlacementSidebar() {
  const gauges = useProject((s) => s.project.gauges);
  const selectedGaugeId = useProject((s) => s.selectedGaugeId);
  const selectGauge = useProject((s) => s.selectGauge);
  const updateGauge = useProject((s) => s.updateGauge);
  const setWorkspaceMode = useProject((s) => s.setWorkspaceMode);

  const sorted = useMemo(() => [...gauges].sort((a, b) => b.z - a.z), [gauges]);
  const placedCount = gauges.filter((g) => g.placed !== false).length;

  return (
    <aside className="w-56 shrink-0 bg-bg-panel border-r border-white/[0.07] p-3.5 overflow-y-auto flex flex-col gap-3">
      <div className="flex items-center">
        <span className="field-label">Gauges on video</span>
        <span className="ml-auto text-[11px] font-mono text-textfaint">{placedCount}/{gauges.length}</span>
      </div>

      {gauges.length === 0 ? (
        <div className="rounded-[10px] bg-bg border border-dashed border-white/[0.16] p-3 flex flex-col gap-2">
          <p className="text-xs text-textfaint leading-relaxed">
            No gauges yet. Create and style gauges in the Gauges tab, then place them on the video here.
          </p>
          <button type="button" className="btn-elevated text-xs" onClick={() => setWorkspaceMode('gauges')}>
            Go to Gauges
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {sorted.map((g) => {
              const plugin = findPluginById(g.pluginId);
              const merged = { ...plugin?.defaultConfig, ...g.config };
              const unsupported = isDataGaugePlugin(g.pluginId) && isUnsupportedGaugeConfig(merged);
              const label = isDataGaugePlugin(g.pluginId)
                ? gaugeDisplayLabel(g, merged)
                : (plugin?.name ?? g.pluginId);
              const isPlaced = g.placed !== false;
              const isSel = g.id === selectedGaugeId;
              return (
                <div
                  key={g.id}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                    isSel ? 'border-accent bg-accent/10' : 'border-white/[0.07] bg-bg-elev'
                  }`}
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left text-xs truncate"
                    onClick={() => selectGauge(g.id)}
                    title="Select gauge"
                  >
                    <span className="font-medium">{label}</span>
                    {unsupported && <span className="ml-1 text-[10px] text-amber-300/70">!</span>}
                    {!isPlaced && <span className="ml-1.5 text-[10px] text-textfaint">configured</span>}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isPlaced}
                    title={isPlaced ? 'Remove from video' : 'Place on video'}
                    onClick={() => {
                      updateGauge(g.id, { placed: !isPlaced });
                      if (!isPlaced) selectGauge(g.id);
                    }}
                    className={`shrink-0 w-9 h-5 rounded-full p-0.5 flex transition-colors ${
                      isPlaced ? 'bg-accent justify-end' : 'bg-bg-hover justify-start'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full ${isPlaced ? 'bg-accent-ink' : 'bg-textfaint'}`} />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[10.5px] text-textfaint leading-relaxed">
            Toggle a gauge onto the video, then drag it to position and use the handles to resize.
            Style and data are edited in the Gauges tab.
          </p>
          <button type="button" className="btn-elevated text-xs" onClick={() => setWorkspaceMode('gauges')}>
            Edit Gauge
          </button>
        </>
      )}
    </aside>
  );
}

function ClipInspector() {
  const clips = useProject((s) => s.project.clips);
  const overlays = useProject((s) => s.project.overlays);
  const sharedTracks = useProject((s) => s.project.sharedTracks);
  const selectedClipId = useProject((s) => s.selectedClipId);
  const selectedOverlayId = useProject((s) => s.selectedOverlayId);
  const selectClip = useProject((s) => s.selectClip);
  const removeClip = useProject((s) => s.removeClip);
  const { addClipFromFile, importAsOverlay, loadSharedFit, loadClipFit } = useMediaImport();
  const busy = useProject((s) => s.busyMessage);
  const [fitMenuOpen, setFitMenuOpen] = useState(false);

  const fitEntries = useMemo(() => {
    const entries: { key: string; brand: string; scope: string; fields: string }[] = [];
    for (const t of sharedTracks.filter((track) => track.source === 'fit')) {
      entries.push({
        key: `shared:${t.id}`,
        brand: t.brand,
        scope: 'Shared',
        fields: t.fields.join(' · '),
      });
    }
    for (const clip of clips) {
      for (const t of clip.localTracks.filter((track) => track.source === 'fit')) {
        entries.push({
          key: `local:${clip.id}:${t.id}`,
          brand: t.brand,
          scope: clip.media.filename,
          fields: t.fields.join(' · '),
        });
      }
    }
    return entries;
  }, [sharedTracks, clips]);

  const deleteClip = (clipId: string) => {
    if (clips.length === 1 && !window.confirm('Remove the only clip?')) return;
    removeClip(clipId);
  };

  return (
    <aside className="w-60 shrink-0 bg-bg-panel border-l border-white/[0.07] p-3.5 overflow-y-auto flex flex-col gap-3">
      <div>
        <div className="flex items-center mb-3">
          <span className="field-label">Clips</span>
          <button
            type="button"
            className="ml-auto btn-elevated text-xs"
            disabled={busy !== null}
            onClick={() => void addClipFromFile()}
          >
            + Add clip…
          </button>
        </div>

        {clips.length === 0 ? (
          <p className="text-xs text-textfaint">No clips yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {clips.map((clip) => {
              const selected = clip.id === selectedClipId;
              return (
                <div
                  key={clip.id}
                  className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 ${
                    selected ? 'border-accent bg-accent/10' : 'border-white/[0.07] bg-bg-elev'
                  }`}
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left"
                    onClick={() => selectClip(clip.id)}
                    title="Select clip"
                  >
                    <div className="text-[13px] font-semibold truncate">{clip.media.filename}</div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Badge>{clip.media.height}p</Badge>
                      <Badge>{(clip.media.fps || 30).toFixed(2)} fps</Badge>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs text-red-300 shrink-0 px-1"
                    title="Remove clip"
                    onClick={() => deleteClip(clip.id)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-px bg-white/[0.07]" />

      <OverlayInspectorSection
        overlays={overlays}
        clips={clips}
        selectedOverlayId={selectedOverlayId}
        busy={busy !== null}
        onImport={() => void importAsOverlay()}
      />

      <div className="h-px bg-white/[0.07]" />

      <div>
        <div className="flex items-center mb-3">
          <span className="field-label">FIT Data</span>
          <div className="relative ml-auto">
            <button
              type="button"
              className="btn-elevated text-xs"
              disabled={clips.length === 0 || busy !== null}
              onClick={() => setFitMenuOpen((open) => !open)}
            >
              + Add FIT Data…
            </button>
            {fitMenuOpen && (
              <div
                className="absolute top-full right-0 mt-1 z-50 panel rounded shadow-lg py-1 w-44"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-white/5"
                  onClick={() => { setFitMenuOpen(false); void loadSharedFit(); }}
                >
                  Shared FIT (project)
                </button>
                <button
                  type="button"
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-white/5"
                  onClick={() => { setFitMenuOpen(false); void loadClipFit(); }}
                >
                  FIT for selected clip
                </button>
              </div>
            )}
          </div>
        </div>

        {fitEntries.length === 0 ? (
          <p className="text-xs text-textfaint">No FIT data yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {fitEntries.map((entry) => (
              <div
                key={entry.key}
                className="rounded-lg border border-white/[0.07] bg-bg-elev px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" />
                  <div className="text-[13px] font-semibold truncate">{entry.brand}</div>
                </div>
                <div className="text-[10.5px] text-textfaint mt-1 truncate" title={entry.scope}>
                  {entry.scope}
                </div>
                <div className="text-[10.5px] text-textdim mt-0.5">{entry.fields}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function OverlayInspectorSection({
  overlays,
  clips,
  selectedOverlayId,
  busy,
  onImport,
}: {
  overlays: VideoOverlayClip[];
  clips: TimelineClip[];
  selectedOverlayId: string | null;
  busy: boolean;
  onImport: () => void;
}) {
  const selectOverlay = useProject((s) => s.selectOverlay);
  const removeOverlay = useProject((s) => s.removeOverlay);
  const setOverlayAlignMode = useProject((s) => s.setOverlayAlignMode);
  const setOverlayOffset = useProject((s) => s.setOverlayOffset);
  const autoAlignOverlayTimestamps = useProject((s) => s.autoAlignOverlayTimestamps);
  const setOverlayRect = useProject((s) => s.setOverlayRect);
  const setOverlayIncludeAudio = useProject((s) => s.setOverlayIncludeAudio);
  const moveOverlayZ = useProject((s) => s.moveOverlayZ);

  const selected = overlays.find((o) => o.id === selectedOverlayId) ?? null;
  const hasTimestampMeta = selected ? videoUtcMs(selected.media) != null : false;
  const baseHasUtc = clips.some((c) => videoUtcMs(c.media) != null);

  return (
    <div>
      <div className="flex items-center mb-3">
        <span className="field-label">Overlays</span>
        <button
          type="button"
          className="ml-auto btn-elevated text-xs"
          disabled={clips.length === 0 || busy}
          onClick={onImport}
        >
          + Add overlay…
        </button>
      </div>

      {overlays.length === 0 ? (
        <p className="text-xs text-textfaint">PiP / B-roll overlays appear on a second timeline track.</p>
      ) : (
        <div className="flex flex-col gap-1.5 mb-3">
          {overlays.map((overlay) => {
            const isSel = overlay.id === selectedOverlayId;
            return (
              <div
                key={overlay.id}
                className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 ${
                  isSel ? 'border-accent bg-accent/10' : 'border-white/[0.07] bg-bg-elev'
                }`}
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left"
                  onClick={() => selectOverlay(overlay.id)}
                >
                  <div className="text-[13px] font-semibold truncate">{overlay.media.filename}</div>
                  <div className="text-[10.5px] text-textfaint mt-0.5">
                    {overlay.alignMode === 'timestamp' ? 'Timestamp' : 'Manual'} · z{overlay.z}
                  </div>
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs text-red-300 shrink-0 px-1"
                  title="Remove overlay"
                  onClick={() => removeOverlay(overlay.id)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-white/[0.07] bg-bg-elev p-2.5">
          <div className="flex gap-1">
            <button
              type="button"
              className={`flex-1 text-xs py-1 rounded ${selected.alignMode === 'timestamp' ? 'bg-accent text-accent-ink' : 'bg-bg-hover'}`}
              onClick={() => setOverlayAlignMode(selected.id, 'timestamp')}
            >
              Timestamp
            </button>
            <button
              type="button"
              className={`flex-1 text-xs py-1 rounded ${selected.alignMode === 'manual' ? 'bg-accent text-accent-ink' : 'bg-bg-hover'}`}
              onClick={() => setOverlayAlignMode(selected.id, 'manual')}
            >
              Manual
            </button>
          </div>

          {selected.alignMode === 'timestamp' && (!hasTimestampMeta || !baseHasUtc) && (
            <p className="text-[10.5px] text-warn leading-relaxed">
              Missing creation_time on { !hasTimestampMeta ? 'overlay' : 'base clip' } — use Manual or add metadata.
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-textfaint">Offset {formatOffsetMs(selected.offsetMs ?? 0)}</span>
            <input
              type="range"
              min={-120_000}
              max={120_000}
              step={100}
              value={selected.offsetMs ?? 0}
              onChange={(e) => setOverlayOffset(selected.id, Number(e.target.value))}
            />
          </label>

          <button
            type="button"
            className="btn-elevated text-xs"
            onClick={() => autoAlignOverlayTimestamps(selected.id)}
          >
            Auto-align timestamps
          </button>

          <div className="grid grid-cols-2 gap-1.5">
            {(['x', 'y', 'w', 'h'] as const).map((key) => (
              <label key={key} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-textfaint uppercase">{key}</span>
                <input
                  type="number"
                  className="input text-xs py-1"
                  min={0}
                  max={1}
                  step={0.01}
                  value={Number(selected.rect[key].toFixed(3))}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    setOverlayRect(selected.id, { ...selected.rect, [key]: v });
                  }}
                />
              </label>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={selected.includeAudio === true}
              onChange={(e) => setOverlayIncludeAudio(selected.id, e.target.checked)}
            />
            Mix overlay audio in export
          </label>

          <div className="flex gap-1">
            <button type="button" className="btn-elevated text-xs flex-1" onClick={() => moveOverlayZ(selected.id, 'down')}>
              Z down
            </button>
            <button type="button" className="btn-elevated text-xs flex-1" onClick={() => moveOverlayZ(selected.id, 'up')}>
              Z up
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1.5 py-0.5 rounded text-[10.5px] bg-bg-elev text-textdim border border-white/[0.07]">{children}</span>
  );
}

interface TrimDrag {
  kind: 'in' | 'out';
  clipId: string;
  startX: number;
  startIn: number;
  startOut: number;
  pxPerMs: number;
}

interface ReorderDrag {
  clipId: string;
  startX: number;
  startGlobalMs: number;
  active: boolean;
  pxPerMs: number;
}

interface OverlayMoveDrag {
  kind: 'move';
  overlayId: string;
  startX: number;
  startGlobalMs: number;
  startEndMs: number;
  pxPerMs: number;
}

interface OverlayTrimDrag {
  kind: 'trim-in' | 'trim-out';
  overlayId: string;
  startX: number;
  startGlobalMs: number;
  startEndMs: number;
  pxPerMs: number;
}

type OverlayDrag = OverlayMoveDrag | OverlayTrimDrag;

const REORDER_DRAG_THRESHOLD_PX = 6;

/** Linear (NLE-style) edit timeline: toolbar + scrubbable ruler + one clip track. */
function EditTimeline() {
  const clips = useProject((s) => s.project.clips);
  const overlays = useProject((s) => s.project.overlays);
  const selectedClipId = useProject((s) => s.selectedClipId);
  const selectedOverlayId = useProject((s) => s.selectedOverlayId);
  const selectClip = useProject((s) => s.selectClip);
  const selectOverlay = useProject((s) => s.selectOverlay);
  const reorderClips = useProject((s) => s.reorderClips);
  const splitClipAtPlayhead = useProject((s) => s.splitClipAtPlayhead);
  const rippleDeleteClip = useProject((s) => s.rippleDeleteClip);
  const setClipTrim = useProject((s) => s.setClipTrim);
  const setClipStartGlobalMs = useProject((s) => s.setClipStartGlobalMs);
  const beginTrimAction = useProject((s) => s.beginTrim);
  const endTrimAction = useProject((s) => s.endTrim);
  const trimInProgress = useProject((s) => s.trimInProgress);
  const previewStale = useProject((s) => s.previewStale);
  const previewBuilding = useProject((s) => s.previewBuilding);
  const generatePreview = useProject((s) => s.generatePreview);
  const setOverlayWindow = useProject((s) => s.setOverlayWindow);
  const removeOverlay = useProject((s) => s.removeOverlay);
  const playhead = useProject((s) => s.playhead);
  const setPlayhead = useProject((s) => s.setPlayhead);
  const setPlaying = useProject((s) => s.setPlaying);
  const { importAsOverlay } = useMediaImport();
  const busy = useProject((s) => s.busyMessage);

  const trackRef = useRef<HTMLDivElement>(null);
  const overlayTrackRef = useRef<HTMLDivElement>(null);
  const timelineAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<TrimDrag | null>(null);
  const overlayDragRef = useRef<OverlayDrag | null>(null);
  const reorderDragRef = useRef<ReorderDrag | null>(null);
  const reorderCaptureRef = useRef<HTMLElement | null>(null);
  const trimCaptureRef = useRef<HTMLElement | null>(null);
  const frozenRulerMsRef = useRef<number | null>(null);
  const clipElRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [reorderUi, setReorderUi] = useState<{
    draggingId: string | null;
    dropIndex: number | null;
    deltaX: number;
  }>({
    draggingId: null,
    dropIndex: null,
    deltaX: 0,
  });

  if (clips.length === 0) {
    return (
      <div className="bg-bg-panel border-t border-white/[0.07] px-3 py-8 text-center text-xs text-textfaint">
        Add a clip to start editing the timeline.
      </div>
    );
  }

  const liveTotal = projectDurationMs(clips, overlays);
  const total = trimInProgress && frozenRulerMsRef.current != null
    ? frozenRulerMsRef.current
    : liveTotal;
  const headPct = total > 0 ? (Math.min(playhead, total) / total) * 100 : 0;
  const firstDims = `${clips[0]!.media.width}×${clips[0]!.media.height}`;
  const mixedRes = clips.some((c) => `${c.media.width}×${c.media.height}` !== firstDims);
  const selectedIndex = clips.findIndex((c) => c.id === selectedClipId);

  const tickMs = total <= 60_000 ? 10_000 : total <= 300_000 ? 30_000 : 60_000;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += tickMs) ticks.push(t);

  const seekFrom = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setPlaying(false);
    setPlayhead(Math.round(ratio * total));
  };

  const beginTrim = (clip: TimelineClip, _clipIndex: number, kind: 'in' | 'out') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const track = trackRef.current;
    if (!track) return;
    const w = track.getBoundingClientRect().width;
    frozenRulerMsRef.current = liveTotal;
    beginTrimAction();
    dragRef.current = {
      kind, clipId: clip.id, startX: e.clientX,
      startIn: clipInMs(clip), startOut: clipOutMs(clip),
      pxPerMs: liveTotal > 0 && w > 0 ? w / liveTotal : 0,
    };
    trimCaptureRef.current = e.currentTarget as HTMLElement;
    trimCaptureRef.current.setPointerCapture(e.pointerId);
  };
  const onTrimMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pxPerMs <= 0) return;
    const dMs = (e.clientX - d.startX) / d.pxPerMs;
    if (d.kind === 'in') setClipTrim(d.clipId, d.startIn + dMs, d.startOut);
    else setClipTrim(d.clipId, d.startIn, d.startOut + dMs);
  };
  const endTrim = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    frozenRulerMsRef.current = null;
    endTrimAction();
    const el = trimCaptureRef.current;
    if (el?.hasPointerCapture(e.pointerId)) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }
    trimCaptureRef.current = null;
  };

  const computeDropIndex = (clientX: number): number => {
    for (let i = 0; i < clips.length; i++) {
      const el = clipElRef.current.get(clips[i]!.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return Math.max(0, clips.length - 1);
  };

  const applyReorder = (clipId: string, toIndex: number) => {
    const fromIndex = clips.findIndex((c) => c.id === clipId);
    if (fromIndex < 0 || fromIndex === toIndex) return;
    const ids = clips.map((c) => c.id);
    const [removed] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, removed!);
    reorderClips(ids);
  };

  const beginReorder = (clip: TimelineClip, clipIndex: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || dragRef.current) return;
    if ((e.target as HTMLElement).closest('[data-trim-handle]')) return;
    const track = trackRef.current;
    if (!track) return;
    e.stopPropagation();
    e.preventDefault();
    const w = track.getBoundingClientRect().width;
    reorderDragRef.current = {
      clipId: clip.id,
      startX: e.clientX,
      startGlobalMs: clipStartGlobalMs(clips, clipIndex),
      active: false,
      pxPerMs: total > 0 && w > 0 ? w / total : 0,
    };
    reorderCaptureRef.current = track;
    track.setPointerCapture(e.pointerId);
  };

  const beginOverlayMove = (overlay: VideoOverlayClip) => (e: React.PointerEvent) => {
    if (e.button !== 0 || dragRef.current) return;
    if ((e.target as HTMLElement).closest('[data-overlay-trim]')) return;
    const track = overlayTrackRef.current;
    if (!track) return;
    e.stopPropagation();
    e.preventDefault();
    const w = track.getBoundingClientRect().width;
    overlayDragRef.current = {
      kind: 'move',
      overlayId: overlay.id,
      startX: e.clientX,
      startGlobalMs: overlay.startGlobalMs,
      startEndMs: overlay.endGlobalMs,
      pxPerMs: total > 0 && w > 0 ? w / total : 0,
    };
    selectOverlay(overlay.id);
    track.setPointerCapture(e.pointerId);
  };

  const beginOverlayTrim = (overlay: VideoOverlayClip, kind: 'trim-in' | 'trim-out') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const track = overlayTrackRef.current;
    if (!track) return;
    const w = track.getBoundingClientRect().width;
    overlayDragRef.current = {
      kind,
      overlayId: overlay.id,
      startX: e.clientX,
      startGlobalMs: overlay.startGlobalMs,
      startEndMs: overlay.endGlobalMs,
      pxPerMs: total > 0 && w > 0 ? w / total : 0,
    };
    track.setPointerCapture(e.pointerId);
  };

  const onOverlayTrackMove = (e: React.PointerEvent) => {
    const d = overlayDragRef.current;
    if (!d || d.pxPerMs <= 0) return;
    const dMs = (e.clientX - d.startX) / d.pxPerMs;
    const dur = d.startEndMs - d.startGlobalMs;
    if (d.kind === 'move') {
      const nextStart = Math.max(0, d.startGlobalMs + dMs);
      setOverlayWindow(d.overlayId, nextStart, nextStart + dur);
    } else if (d.kind === 'trim-in') {
      setOverlayWindow(d.overlayId, Math.max(0, d.startGlobalMs + dMs), d.startEndMs);
    } else {
      setOverlayWindow(d.overlayId, d.startGlobalMs, Math.max(d.startGlobalMs + 100, d.startEndMs + dMs));
    }
  };

  const endOverlayDrag = (e: React.PointerEvent) => {
    if (!overlayDragRef.current) return;
    overlayDragRef.current = null;
    const el = overlayTrackRef.current;
    if (el?.hasPointerCapture(e.pointerId)) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }
  };

  const onTrackPointerMove = (e: React.PointerEvent) => {
    if (overlayDragRef.current) {
      onOverlayTrackMove(e);
      return;
    }
    if (dragRef.current) {
      onTrimMove(e);
      return;
    }
    const rd = reorderDragRef.current;
    if (!rd) return;
    const deltaX = e.clientX - rd.startX;
    if (!rd.active && Math.abs(deltaX) >= REORDER_DRAG_THRESHOLD_PX) {
      rd.active = true;
    }
    if (rd.active) {
      setReorderUi({
        draggingId: rd.clipId,
        dropIndex: computeDropIndex(e.clientX),
        deltaX,
      });
    }
  };

  const finishReorder = (e: React.PointerEvent) => {
    const rd = reorderDragRef.current;
    if (!rd) return;
    const fromIndex = clips.findIndex((c) => c.id === rd.clipId);
    if (rd.active) {
      const dropIndex = computeDropIndex(e.clientX);
      if (dropIndex !== fromIndex) {
        applyReorder(rd.clipId, dropIndex);
      } else if (rd.pxPerMs > 0) {
        const deltaMs = (e.clientX - rd.startX) / rd.pxPerMs;
        setClipStartGlobalMs(rd.clipId, Math.max(0, rd.startGlobalMs + deltaMs));
      }
    } else {
      selectClip(rd.clipId);
    }
    reorderDragRef.current = null;
    setReorderUi({ draggingId: null, dropIndex: null, deltaX: 0 });
    const el = reorderCaptureRef.current;
    if (el?.hasPointerCapture(e.pointerId)) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }
    reorderCaptureRef.current = null;
  };

  const cancelReorder = (e: React.PointerEvent) => {
    if (!reorderDragRef.current) return;
    reorderDragRef.current = null;
    setReorderUi({ draggingId: null, dropIndex: null, deltaX: 0 });
    const el = reorderCaptureRef.current;
    if (el?.hasPointerCapture(e.pointerId)) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }
    reorderCaptureRef.current = null;
  };

  const onTrackPointerUp = (e: React.PointerEvent) => {
    if (overlayDragRef.current) {
      endOverlayDrag(e);
      return;
    }
    if (dragRef.current) {
      endTrim(e);
      return;
    }
    finishReorder(e);
  };

  return (
    <div className="bg-bg-panel border-t border-white/[0.07] flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-white/[0.07]">
        <button type="button" className="btn-primary text-xs flex items-center gap-1.5" title="Split clip at playhead" onClick={splitClipAtPlayhead}>
          <SplitGlyph /> Split
        </button>
        <button
          type="button"
          className="btn-elevated text-xs"
          disabled={busy !== null}
          onClick={() => void importAsOverlay()}
        >
          + Add overlay
        </button>
        <button
          type="button"
          className="btn-danger text-xs disabled:opacity-40"
          title="Ripple delete selected clip"
          disabled={selectedIndex < 0}
          onClick={() => selectedClipId && rippleDeleteClip(selectedClipId)}
        >
          Ripple delete
        </button>
        {(previewStale || previewBuilding) && !trimInProgress && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-elevated text-xs flex items-center gap-1.5 relative"
              disabled={previewBuilding || busy !== null}
              onClick={() => generatePreview()}
              title="Rebuild concatenated preview from current clips"
            >
              {previewBuilding ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                  Generate Preview
                </>
              )}
            </button>
          </div>
        )}
        <span className="ml-auto text-[11px] font-mono text-textfaint">
          {clips.length} clip{clips.length !== 1 ? 's' : ''}
          {overlays.length > 0 && ` · ${overlays.length} overlay${overlays.length !== 1 ? 's' : ''}`}
          {' · '}{fmtClock(total)}
        </span>
      </div>

      {mixedRes && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 border-b border-white/[0.07]" style={{ background: 'rgba(245,177,74,0.08)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-warn" />
          <span className="text-[11px] text-warn">
            Clips have mixed resolutions — export normalizes to the first clip ({firstDims}).
          </span>
        </div>
      )}

      {/* Ruler + clip track */}
      <div ref={timelineAreaRef} className="p-3.5 bg-[#0c1014]">
        <div
          className="relative h-5 border-b border-white/[0.07] cursor-text touch-none"
          onPointerDown={(e) => {
            const el = timelineAreaRef.current;
            if (el) seekFrom(e.clientX, el);
          }}
        >
          {ticks.map((t) => (
            <div key={t} className="absolute bottom-0" style={{ left: `${(t / total) * 100}%` }}>
              <div className="w-px h-2 bg-white/[0.16]" />
              <span className="absolute left-0.5 bottom-1.5 text-[9px] font-mono text-textfaint whitespace-nowrap">{fmtClock(t)}</span>
            </div>
          ))}
          <Playhead pct={headPct} head />
        </div>

        <div
          ref={trackRef}
          className="relative mt-2 h-16 touch-none"
          onPointerDown={(e) => { if (e.target === e.currentTarget) seekFrom(e.clientX, e.currentTarget); }}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={(e) => {
            if (dragRef.current) endTrim(e);
            else cancelReorder(e);
          }}
        >
          {clips.map((clip, i) => {
            const selected = clip.id === selectedClipId;
            const dragging = clip.id === reorderUi.draggingId;
            const dropTarget = reorderUi.dropIndex === i && reorderUi.draggingId != null && !dragging;
            const leftPct = total > 0 ? (clipStartGlobalMs(clips, i) / total) * 100 : 0;
            const wPct = total > 0 ? (clipDurationMs(clip) / total) * 100 : 100 / clips.length;
            const dims = `${clip.media.width}×${clip.media.height}`;
            return (
              <div
                key={clip.id}
                ref={(el) => {
                  if (el) clipElRef.current.set(clip.id, el);
                  else clipElRef.current.delete(clip.id);
                }}
                className={`absolute top-0 bottom-0 rounded-md overflow-hidden border-[1.5px] touch-none ${
                  dragging ? 'opacity-60 z-20 cursor-grabbing shadow-lg' : 'cursor-grab'
                } ${dropTarget ? 'ring-2 ring-accent/80' : selected ? 'border-accent' : 'border-white/[0.07]'}`}
                style={{
                  left: `${leftPct}%`,
                  width: `${wPct}%`,
                  minWidth: 28,
                  background: clipHue(i),
                  transform: dragging ? `translateX(${reorderUi.deltaX}px)` : undefined,
                }}
                onPointerDown={beginReorder(clip, i)}
                title={`${clip.media.filename} — drag to move or reorder`}
              >
                <div className="absolute inset-0 flex opacity-50 pointer-events-none">
                  {Array.from({ length: 8 }).map((_, k) => (
                    <div key={k} className="flex-1 border-r border-black/20" style={{ background: k % 2 ? 'rgba(255,255,255,0.04)' : 'transparent' }} />
                  ))}
                </div>
                <div className="absolute left-2 top-1.5 right-2 pointer-events-none">
                  <div className="truncate text-[11px] font-semibold text-white">{clip.media.filename}</div>
                </div>
                <span className="absolute left-2 bottom-1.5 text-[10px] font-mono text-white/80 pointer-events-none">{fmtClock(clipDurationMs(clip))}</span>
                {dims !== firstDims && (
                  <span className="absolute right-1.5 bottom-1.5 text-[9px] font-bold text-warn pointer-events-none">{clip.media.height}p</span>
                )}
                {selected && (
                  <>
                    <div
                      data-trim-handle
                      className="absolute left-0 top-0 bottom-0 w-1.5 bg-accent cursor-ew-resize flex items-center justify-center z-10"
                      onPointerDown={beginTrim(clip, i, 'in')}
                      title="Trim in"
                    >
                      <div className="w-0.5 h-4 rounded bg-black/60 pointer-events-none" />
                    </div>
                    <div
                      data-trim-handle
                      className="absolute right-0 top-0 bottom-0 w-1.5 bg-accent cursor-ew-resize flex items-center justify-center z-10"
                      onPointerDown={beginTrim(clip, i, 'out')}
                      title="Trim out"
                    >
                      <div className="w-0.5 h-4 rounded bg-black/60 pointer-events-none" />
                    </div>
                  </>
                )}
              </div>
            );
          })}
          <Playhead pct={headPct} />
          {trimInProgress && dragRef.current && (() => {
            const d = dragRef.current;
            const clip = clips.find((c) => c.id === d.clipId);
            const clipEl = clipElRef.current.get(d.clipId);
            const track = trackRef.current;
            if (!clip || !clipEl || !track) return null;
            const clipRect = clipEl.getBoundingClientRect();
            const trackRect = track.getBoundingClientRect();
            return (
              <TrimFramePopover
                clip={clip}
                kind={d.kind}
                leftPx={d.kind === 'in'
                  ? clipRect.left - trackRect.left
                  : clipRect.right - trackRect.left}
                trackWidth={trackRect.width}
              />
            );
          })()}
        </div>

        {/* Overlay track */}
        <div
          ref={overlayTrackRef}
          className="relative mt-1 h-10 rounded-md bg-bg border border-white/[0.07] touch-none"
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            const el = timelineAreaRef.current;
            if (el) seekFrom(e.clientX, el);
          }}
          onPointerMove={onOverlayTrackMove}
          onPointerUp={endOverlayDrag}
          onPointerCancel={endOverlayDrag}
        >
          <span className="absolute left-1.5 top-1 text-[9px] font-mono text-textfaint pointer-events-none z-10">OVR</span>
          {overlays.map((overlay, i) => {
            const selected = overlay.id === selectedOverlayId;
            const leftPct = total > 0 ? (overlay.startGlobalMs / total) * 100 : 0;
            const wPct = total > 0 ? ((overlay.endGlobalMs - overlay.startGlobalMs) / total) * 100 : 0;
            return (
              <div
                key={overlay.id}
                className={`absolute top-1 bottom-1 rounded border touch-none cursor-grab ${
                  selected ? 'border-accent ring-1 ring-accent/50' : 'border-white/[0.12]'
                }`}
                style={{
                  left: `${leftPct}%`,
                  width: `${Math.max(wPct, 0.5)}%`,
                  minWidth: 24,
                  background: clipHue(i + 3),
                }}
                onPointerDown={beginOverlayMove(overlay)}
                title={`${overlay.media.filename} — drag to move`}
              >
                <div className="absolute inset-x-1 top-0.5 truncate text-[10px] font-semibold text-white pointer-events-none">
                  {overlay.media.filename}
                </div>
                {selected && (
                  <>
                    <div
                      data-overlay-trim
                      className="absolute left-0 top-0 bottom-0 w-1.5 bg-accent cursor-ew-resize z-10"
                      onPointerDown={beginOverlayTrim(overlay, 'trim-in')}
                    />
                    <div
                      data-overlay-trim
                      className="absolute right-0 top-0 bottom-0 w-1.5 bg-accent cursor-ew-resize z-10"
                      onPointerDown={beginOverlayTrim(overlay, 'trim-out')}
                    />
                    <button
                      type="button"
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500/90 text-[10px] text-white z-20"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeOverlay(overlay.id)}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          })}
          <Playhead pct={headPct} />
        </div>

        <div className="flex items-center mt-2 text-[11px] text-textfaint">
          <span>Click ruler to scrub · drag clips to reorder · overlay track below for PiP</span>
          <span className="ml-auto">Split at playhead · ripple delete</span>
        </div>
      </div>
    </div>
  );
}

function TrimFramePopover({
  clip,
  kind,
  leftPx,
  trackWidth,
}: {
  clip: TimelineClip;
  kind: 'in' | 'out';
  leftPx: number;
  trackWidth: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSeekRef = useRef(0);
  const sourceMs = kind === 'in' ? clipInMs(clip) : clipOutMs(clip);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const targetSec = sourceMs / 1000;
    const now = Date.now();
    const elapsed = now - lastSeekRef.current;
    const doSeek = () => {
      lastSeekRef.current = Date.now();
      if (Math.abs(el.currentTime - targetSec) > 0.04) {
        el.currentTime = targetSec;
      }
    };
    if (elapsed >= 100) {
      doSeek();
      return;
    }
    const timer = window.setTimeout(doSeek, 100 - elapsed);
    return () => window.clearTimeout(timer);
  }, [sourceMs]);

  const left = Math.max(8, Math.min(leftPx, trackWidth - 148));

  return (
    <div
      className="absolute z-30 pointer-events-none"
      style={{ left, bottom: '100%', marginBottom: 6 }}
    >
      <video
        ref={videoRef}
        src={localMediaUrl(clip.media.path)}
        muted
        playsInline
        preload="auto"
        className="w-[140px] aspect-video rounded border border-white/20 bg-black object-cover"
      />
      <div className="mt-0.5 text-center text-[9px] font-mono text-textfaint">
        {fmtClock(sourceMs)}
      </div>
    </div>
  );
}

function Playhead({ pct, head }: { pct: number; head?: boolean }) {
  return (
    <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: `${pct}%`, width: 0 }}>
      <div className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-accent" />
      {head && (
        <div className="absolute -top-px -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '6px solid #3ddc97' }} />
      )}
    </div>
  );
}

function SplitGlyph() {
  return (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none">
      <path d="M8 1v14" stroke="currentColor" strokeWidth={1.4} strokeDasharray="2 2" />
      <path d="M3 5l2.5 3L3 11M13 5l-2.5 3L13 11" stroke="currentColor" strokeWidth={1.4} fill="none" />
    </svg>
  );
}

function clipHue(index: number): string {
  const hues = ['#2f6f53', '#3a5a7a', '#6a5a8a', '#7a5a4a', '#4a6a5a', '#5a4a7a'];
  return hues[index % hues.length]!;
}
