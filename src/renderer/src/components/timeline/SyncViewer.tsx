import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MediaSource,
  Project,
  TelemetryTrack,
  TimelineClip,
  TrackSyncSettings,
} from '@shared/types';
import { fitOffsetSliderRange } from '@shared/sync';
import {
  clipDurationMs,
  clipEndGlobalMs,
  clipInMs,
  clipStartGlobalMs,
} from '@shared/timeline';
import { useProject } from '../../store/project';
import { usePreferences } from '../../store/preferences';
import { frameAtClipLocalTime } from '../../lib/telemetry';
import {
  formatFieldValue,
  normalizeSeries,
  trackSyncSignals,
  type SignalSeries,
} from '../../lib/syncSignals';

interface Props {
  project: Project;
  selectedClip: TimelineClip;
  selectedClipIndex: number;
  /** Global ms where the selected clip starts on the concatenated timeline. */
  selectedClipStartMs: number;
  /** Sum of every clip's duration on the global timeline. */
  totalDurationMs: number;
  /** Start ms (global) of every clip + final boundary — length = clips.length + 1. */
  clipBoundariesMs: number[];
  fitTrack: TelemetryTrack;
  /** Selected clip's effective FIT offset (clip-local ms where FIT t=0 sits). */
  fitOffsetMs: number;
  clipDurationMs: number;
  /** Clip-local playhead when playhead is in the selected clip; otherwise null. */
  clipLocalPlayheadMs: number | null;
  /** Global playhead (ms on concatenated timeline). */
  globalPlayheadMs: number;
  clipMedia: MediaSource;
  syncTracks: TelemetryTrack[];
  syncMap: Record<string, TrackSyncSettings>;
  fitDragEnabled: boolean;
  onOffsetChange: (ms: number) => void;
}

const PAD = { l: 48, r: 12, t: 8, b: 26 };
const RULER_H = 24;
const ROW_H = 32;
const HEADER_H = 16;
const BLOCK_GAP = 8;
const LANE_GAP = 2;
const CLIP_LABEL_H = 14;
/** Extra timeline (ms) beyond clip / FIT marker so offset can be scrolled into view. */
const VIEW_PAD_MS = 30_000;

function fitTrackDurationMs(track: TelemetryTrack): number {
  if (track.frames.length === 0) return 0;
  return track.frames[track.frames.length - 1]!.offsetMs;
}

function computeSyncViewRange(
  totalDurationMs: number,
  globalFitT0Ms: number,
  fitDurMs: number,
): { minMs: number; maxMs: number } {
  const minMs = Math.min(0, globalFitT0Ms - VIEW_PAD_MS);
  const maxMs = Math.max(
    totalDurationMs,
    globalFitT0Ms + VIEW_PAD_MS,
    globalFitT0Ms + fitDurMs + VIEW_PAD_MS,
  );
  return { minMs, maxMs };
}

/**
 * Visual manual-sync panel — renders FIT signals across the **full** concatenated
 * timeline (all clips). Horizontally scrollable when FIT or extra clips overflow
 * the viewport. Drag the FIT block to align it with the selected clip.
 */
export function SyncViewer({
  fitTrack,
  fitOffsetMs,
  clipDurationMs,
  clipLocalPlayheadMs,
  globalPlayheadMs,
  clipMedia,
  syncTracks,
  syncMap,
  project,
  selectedClip,
  selectedClipIndex,
  selectedClipStartMs,
  totalDurationMs,
  clipBoundariesMs,
  fitDragEnabled,
  onOffsetChange,
}: Props) {
  const setPlayhead = useProject((s) => s.setPlayhead);
  const setPlaying = useProject((s) => s.setPlaying);
  const unitPrefs = usePreferences((s) => s.settings);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const scrubRef = useRef(false);
  const userScrolledRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(640);

  /**
   * Global timeline position (ms) where FIT t=0 sits, from the selected clip's
   * perspective. FIT is sampled against source time (telemetry.ts): ride time =
   * (clipInMs + clip-local ms) − offset, so ride 0 sits at clip-local time
   * (offset − clipInMs). Subtracting clipInMs keeps the waveform aligned with the
   * gauge overlay on trimmed clips (no-op when the clip is untrimmed).
   */
  const globalFitT0Ms = selectedClipStartMs + fitOffsetMs - clipInMs(selectedClip);
  const fitDurMs = fitTrackDurationMs(fitTrack);
  const viewRange = useMemo(
    () => computeSyncViewRange(totalDurationMs, globalFitT0Ms, fitDurMs),
    [totalDurationMs, globalFitT0Ms, fitDurMs],
  );
  const viewSpanMs = viewRange.maxMs - viewRange.minMs;

  // Keep the selected clip approximately viewport-width — preserves the
  // per-clip rendering density even when the timeline grows.
  const densityMs = clipDurationMs > 0 ? clipDurationMs : totalDurationMs;
  const pxPerMs = viewportWidth > 0 && densityMs > 0
    ? (viewportWidth - PAD.l - PAD.r) / densityMs
    : 0;
  const contentWidth = pxPerMs > 0
    ? Math.max(viewportWidth, Math.ceil(PAD.l + PAD.r + viewSpanMs * pxPerMs))
    : viewportWidth;

  const offsetRange = fitOffsetSliderRange(
    syncTracks,
    clipDurationMs,
    syncMap,
    clipMedia,
  );

  // Sample FIT across the *whole* visible timeline (including any negative
  // region if FIT started before clip 0). `globalFitT0Ms` is the timeline
  // position where FIT t=0 sits.
  const fitSignals = useMemo(
    () => trackSyncSignals(fitTrack, viewRange.minMs, viewRange.maxMs, globalFitT0Ms),
    [fitTrack, viewRange.minMs, viewRange.maxMs, globalFitT0Ms],
  );

  const merged = clipLocalPlayheadMs != null
    ? frameAtClipLocalTime(project, selectedClip, clipLocalPlayheadMs)
    : frameAtClipLocalTime(project, selectedClip, 0);

  const layout = useMemo(() => {
    const fitLaneCount = Math.max(1, fitSignals.length);
    const fitBlockTop = PAD.t + RULER_H + BLOCK_GAP;
    const fitLanesTop = fitBlockTop + HEADER_H;
    const fitBlockH = fitLaneCount * ROW_H + (fitLaneCount - 1) * LANE_GAP;
    const h = fitLanesTop + fitBlockH + CLIP_LABEL_H + PAD.b;
    return { h, fitBlockTop, fitLanesTop, fitBlockH };
  }, [fitSignals.length]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    ro.observe(el);
    setViewportWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // When the user changes selected clip, re-center the auto-scroll behaviour.
  useEffect(() => {
    userScrolledRef.current = false;
  }, [selectedClip.id]);

  // Keep the selected clip visible when it / the FIT marker changes, unless
  // the user has manually scrolled.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || pxPerMs <= 0 || userScrolledRef.current) return;
    const xAt = (ms: number) => PAD.l + (ms - viewRange.minMs) * pxPerMs;
    const clipLeft = xAt(selectedClipStartMs);
    const clipRight = xAt(selectedClipStartMs + clipDurationMs);
    const margin = 32;
    if (clipLeft < wrap.scrollLeft + margin) {
      wrap.scrollLeft = Math.max(0, clipLeft - margin);
    } else if (clipRight > wrap.scrollLeft + wrap.clientWidth - margin) {
      wrap.scrollLeft = Math.max(0, clipRight - wrap.clientWidth + margin);
    }
  }, [
    selectedClipStartMs,
    clipDurationMs,
    viewRange.minMs,
    pxPerMs,
    contentWidth,
    viewportWidth,
  ]);

  const draw = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs || contentWidth <= 0 || densityMs <= 0 || pxPerMs <= 0) return;
    const { h, fitBlockTop, fitLanesTop, fitBlockH } = layout;
    const { minMs: viewMinMs, maxMs: viewMaxMs } = viewRange;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = Math.floor(contentWidth * dpr);
    cvs.height = Math.floor(h * dpr);
    cvs.style.width = `${contentWidth}px`;
    cvs.style.height = `${h}px`;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, contentWidth, h);

    const plotW = contentWidth - PAD.l - PAD.r;
    const xAt = (ms: number) => PAD.l + (ms - viewMinMs) * pxPerMs;

    // Ruler background.
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(PAD.l, PAD.t, plotW, RULER_H);

    // Concatenated-timeline strip: subtle band for [0, totalDurationMs].
    const timelineX0 = xAt(0);
    const timelineX1 = xAt(totalDurationMs);
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(
      timelineX0,
      PAD.t + RULER_H,
      Math.max(0, timelineX1 - timelineX0),
      h - PAD.t - PAD.b - RULER_H - CLIP_LABEL_H,
    );

    // Highlight the *selected* clip window across all panel rows.
    const selX0 = xAt(selectedClipStartMs);
    const selX1 = xAt(selectedClipStartMs + clipDurationMs);
    ctx.fillStyle = 'rgba(61,220,151,0.06)';
    ctx.fillRect(
      selX0,
      PAD.t + RULER_H,
      Math.max(0, selX1 - selX0),
      h - PAD.t - PAD.b - RULER_H - CLIP_LABEL_H,
    );

    // Ruler ticks. Adapt density to span length.
    const spanSec = (viewMaxMs - viewMinMs) / 1000;
    const tickStepSec =
      spanSec > 3600 ? 60 : spanSec > 900 ? 30 : spanSec > 240 ? 10 : 5;
    const labelStepSec = Math.max(60, tickStepSec * 6);
    const viewStartSec = Math.floor(viewMinMs / 1000);
    const viewEndSec = Math.ceil(viewMaxMs / 1000);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let s = viewStartSec - (viewStartSec % tickStepSec); s <= viewEndSec; s += tickStepSec) {
      const x = xAt(s * 1000);
      if (x < PAD.l - 1 || x > PAD.l + plotW + 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, h - PAD.b - CLIP_LABEL_H);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '400 9px JetBrains Mono, ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (let s = viewStartSec - (viewStartSec % tickStepSec); s <= viewEndSec; s += tickStepSec) {
      if (s === 0 || s % labelStepSec !== 0) continue;
      const x = xAt(s * 1000);
      if (x < PAD.l || x > PAD.l + plotW - 28) continue;
      ctx.fillText(formatVideoTime(s * 1000), x + 2, PAD.t + RULER_H / 2);
    }

    // Clip boundary dividers + per-clip labels along the bottom.
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '500 10px JetBrains Mono, ui-monospace, monospace';
    ctx.textBaseline = 'top';
    for (let i = 0; i < project.clips.length; i++) {
      const segStart = clipStartGlobalMs(project.clips, i);
      const segEnd = clipEndGlobalMs(project.clips, i);
      const bx = xAt(segStart);
      if (bx >= PAD.l - 1 && bx <= PAD.l + plotW + 1) {
        ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, PAD.t);
        ctx.lineTo(bx, h - PAD.b - CLIP_LABEL_H + 2);
        ctx.stroke();
      }

      const segXmid = xAt((segStart + segEnd) / 2);
      if (segXmid >= PAD.l && segXmid <= PAD.l + plotW) {
        const isSel = i === selectedClipIndex;
        ctx.fillStyle = isSel ? 'rgba(61,220,151,0.85)' : 'rgba(255,255,255,0.45)';
        ctx.font = isSel
          ? '600 10px JetBrains Mono, ui-monospace, monospace'
          : '500 10px JetBrains Mono, ui-monospace, monospace';
        const label = `Clip ${i + 1}`;
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, segXmid - tw / 2, h - PAD.b - CLIP_LABEL_H + 2);
      }
    }

    // FIT panel header.
    ctx.font = '600 10px JetBrains Mono, ui-monospace, monospace';
    ctx.fillStyle = 'rgba(61,220,151,0.75)';
    ctx.textBaseline = 'top';
    ctx.fillText('FIT', PAD.l + 4, fitBlockTop);

    const fitX0 = xAt(globalFitT0Ms);
    const fitX1 = xAt(globalFitT0Ms + fitDurMs);

    if (fitSignals.length > 0) {
      fitSignals.forEach((series, idx) => {
        const y = fitLanesTop + idx * (ROW_H + LANE_GAP);
        drawLane(ctx, y, series, fitX0, fitX1, plotW, xAt, viewMinMs, viewMaxMs);
      });
    } else {
      const y = fitLanesTop;
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(PAD.l, y, plotW, ROW_H);
      ctx.fillStyle = 'rgba(61,220,151,0.08)';
      const blockLeft = Math.max(PAD.l, fitX0);
      const blockRight = Math.min(PAD.l + plotW, fitX1);
      ctx.fillRect(blockLeft, y, Math.max(0, blockRight - blockLeft), ROW_H);
    }

    // FIT t=0 marker (drawn relative to the selected clip's offset).
    if (fitX0 >= PAD.l - 2 && fitX0 <= PAD.l + plotW + 2) {
      ctx.strokeStyle = 'rgba(61,220,151,0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(fitX0, fitBlockTop);
      ctx.lineTo(fitX0, fitLanesTop + fitBlockH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(61,220,151,0.9)';
      ctx.font = '500 9px JetBrains Mono, ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      ctx.fillText('FIT 0:00', fitX0 + 3, fitBlockTop - 2);
    }

    if (fitDurMs > 0 && fitX1 >= PAD.l && fitX1 <= PAD.l + plotW + 40) {
      ctx.fillStyle = 'rgba(61,220,151,0.55)';
      ctx.font = '400 9px JetBrains Mono, ui-monospace, monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(formatVideoTime(fitDurMs), fitX1 + 2, fitLanesTop + fitBlockH + 2);
    }

    // Global playhead.
    const px = xAt(globalPlayheadMs);
    if (px >= PAD.l && px <= PAD.l + plotW) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, PAD.t);
      ctx.lineTo(px, h - PAD.b - CLIP_LABEL_H);
      ctx.stroke();
    }
  }, [
    globalFitT0Ms,
    fitDurMs,
    fitSignals,
    layout,
    globalPlayheadMs,
    densityMs,
    contentWidth,
    pxPerMs,
    viewRange,
    selectedClipIndex,
    selectedClipStartMs,
    clipDurationMs,
    clipBoundariesMs,
    totalDurationMs,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pxPerMsForDrag = pxPerMs;

  const scrubFromClientX = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || pxPerMsForDrag <= 0) return;
    const x = clientX - rect.left;
    const ms = viewRange.minMs + (x - PAD.l) / pxPerMsForDrag;
    setPlaying(false);
    setPlayhead(Math.round(clamp(ms, 0, totalDurationMs)));
  };

  const isInFitDragZone = (clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const y = clientY - rect.top;
    const { fitBlockTop, fitLanesTop, fitBlockH } = layout;
    return y >= fitBlockTop && y <= fitLanesTop + fitBlockH;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!fitDragEnabled) {
      scrubRef.current = true;
      scrubFromClientX(e.clientX);
      userScrolledRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (!isInFitDragZone(e.clientY)) return;
    dragRef.current = { startX: e.clientX, startOffset: fitOffsetMs };
    userScrolledRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (scrubRef.current) {
      scrubFromClientX(e.clientX);
      return;
    }
    const d = dragRef.current;
    if (!d || pxPerMsForDrag <= 0) return;
    const deltaMs = Math.round((e.clientX - d.startX) / pxPerMsForDrag);
    const next = clamp(d.startOffset + deltaMs, offsetRange.min, offsetRange.max);
    onOffsetChange(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    scrubRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div className="border-t border-white/5 px-3 py-2 flex flex-col gap-2 flex-1 min-h-0">
      <div
        ref={wrapRef}
        className="w-full flex-1 min-h-0 rounded-md bg-black/30 border border-white/5 overflow-x-auto overflow-y-auto"
        onScroll={() => { userScrolledRef.current = true; }}
      >
        <canvas
          ref={canvasRef}
          className={`block touch-pan-x ${fitDragEnabled ? 'cursor-ew-resize' : 'cursor-crosshair'}`}
          style={{ minWidth: contentWidth > viewportWidth ? contentWidth : undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {fitSignals.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
          {fitSignals.map((s) => (
            <div key={s.field} className="rounded bg-white/[0.03] px-2 py-1 text-white/50">
              <span style={{ color: s.color }}>{s.field}</span>
              {' '}
              {formatFieldValue(s.field, merged[s.field] as number | undefined, unitPrefs)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function drawLane(
  ctx: CanvasRenderingContext2D,
  y: number,
  series: SignalSeries,
  fitX0: number,
  fitX1: number,
  plotW: number,
  xAt: (ms: number) => number,
  viewMinMs: number,
  viewMaxMs: number,
) {
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(PAD.l, y, plotW, ROW_H);

  ctx.fillStyle = 'rgba(61,220,151,0.08)';
  const blockLeft = Math.max(PAD.l, fitX0);
  const blockRight = Math.min(PAD.l + plotW, fitX1);
  ctx.fillRect(blockLeft, y, Math.max(0, blockRight - blockLeft), ROW_H);
  ctx.strokeStyle = 'rgba(61,220,151,0.35)';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(blockLeft + 0.5, y + 0.5, Math.max(0, blockRight - blockLeft - 1), ROW_H - 1);
  ctx.setLineDash([]);

  const normalized = normalizeSeries(series.values);
  ctx.strokeStyle = series.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < normalized.length; i++) {
    const videoT = series.startMs + i * series.stepMs;
    if (videoT < viewMinMs || videoT > viewMaxMs) continue;
    const x = xAt(videoT);
    if (x < PAD.l - 1 || x > PAD.l + plotW + 1) continue;
    const v = series.values[i];
    if (v === null) {
      started = false;
      continue;
    }
    const yy = y + ROW_H - 3 - normalized[i]! * (ROW_H - 6);
    if (!started) {
      ctx.moveTo(x, yy);
      started = true;
    } else {
      ctx.lineTo(x, yy);
    }
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 9px JetBrains Mono, ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(series.label, PAD.l + 4, y + ROW_H / 2);
}

function formatVideoTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
