import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, TelemetryTrack } from '@shared/types';
import { fitOffsetSliderRange, fitSampleTimeMs, formatOffsetMs } from '@shared/sync';
import { frameAtVideoTime } from '../../lib/telemetry';
import {
  formatFieldValue,
  normalizeSeries,
  trackSyncSignals,
  type SignalSeries,
} from '../../lib/syncSignals';

interface Props {
  project: Project;
  fitTrack: TelemetryTrack;
  fitOffsetMs: number;
  videoDurationMs: number;
  playheadMs: number;
  onOffsetChange: (ms: number) => void;
}

const PAD = { l: 48, r: 12, t: 8, b: 22 };
const RULER_H = 24;
const ROW_H = 32;
const HEADER_H = 16;
const BLOCK_GAP = 8;
const LANE_GAP = 2;

/**
 * Visual manual-sync panel — FIT signals on the video timeline; drag the
 * FIT block to slide it into alignment.
 */
export function SyncViewer({
  project,
  fitTrack,
  fitOffsetMs,
  videoDurationMs,
  playheadMs,
  onOffsetChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const [width, setWidth] = useState(640);

  const offsetRange = fitOffsetSliderRange(project.tracks, videoDurationMs, project.trackSync);
  const fitSignals = useMemo(
    () => trackSyncSignals(fitTrack, videoDurationMs, fitOffsetMs),
    [fitTrack, videoDurationMs, fitOffsetMs],
  );
  const merged = frameAtVideoTime(project, playheadMs);
  const fitLocalMs = fitSampleTimeMs(playheadMs, fitOffsetMs);

  const layout = useMemo(() => {
    const fitLaneCount = Math.max(1, fitSignals.length);
    const fitBlockTop = PAD.t + RULER_H + BLOCK_GAP;
    const fitLanesTop = fitBlockTop + HEADER_H;
    const fitBlockH = fitLaneCount * ROW_H + (fitLaneCount - 1) * LANE_GAP;
    const h = fitLanesTop + fitBlockH + PAD.b;

    return { h, fitBlockTop, fitLanesTop, fitBlockH };
  }, [fitSignals.length]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs || width <= 0 || videoDurationMs <= 0) return;
    const { h, fitBlockTop, fitLanesTop, fitBlockH } = layout;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = Math.floor(width * dpr);
    cvs.height = Math.floor(h * dpr);
    cvs.style.width = `${width}px`;
    cvs.style.height = `${h}px`;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);

    const plotW = width - PAD.l - PAD.r;
    const xAt = (ms: number) => PAD.l + (ms / videoDurationMs) * plotW;

    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(PAD.l, PAD.t, plotW, RULER_H);

    const tickStepSec = videoDurationMs > 120_000 ? 10 : 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let s = 0; s <= Math.ceil(videoDurationMs / 1000); s += tickStepSec) {
      const x = xAt(s * 1000);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, h - PAD.b);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '400 9px JetBrains Mono, ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (let s = 0; s <= Math.ceil(videoDurationMs / 1000); s += tickStepSec) {
      if (s === 0) continue;
      const label = formatVideoTime(s * 1000);
      ctx.fillText(label, xAt(s * 1000) + 2, PAD.t + RULER_H / 2);
    }

    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(61,220,151,0.75)';
    ctx.textBaseline = 'top';
    ctx.fillText('FIT', PAD.l + 4, fitBlockTop);

    const fitDur = fitTrack.frames.length > 0
      ? fitTrack.frames[fitTrack.frames.length - 1].offsetMs
      : 0;
    const fitX0 = xAt(Math.max(0, fitOffsetMs));
    const fitX1 = xAt(Math.min(videoDurationMs, fitOffsetMs + fitDur));

    if (fitSignals.length > 0) {
      fitSignals.forEach((series, idx) => {
        const y = fitLanesTop + idx * (ROW_H + LANE_GAP);
        drawLane(ctx, y, series, fitX0, fitX1, plotW, xAt);
      });
    } else {
      const y = fitLanesTop;
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(PAD.l, y, plotW, ROW_H);
      ctx.fillStyle = 'rgba(61,220,151,0.08)';
      ctx.fillRect(fitX0, y, Math.max(0, fitX1 - fitX0), ROW_H);
    }

    if (fitOffsetMs >= 0 && fitOffsetMs <= videoDurationMs) {
      const x0 = xAt(fitOffsetMs);
      ctx.strokeStyle = 'rgba(61,220,151,0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x0, fitBlockTop);
      ctx.lineTo(x0, fitLanesTop + fitBlockH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(61,220,151,0.9)';
      ctx.font = '500 9px JetBrains Mono, ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      ctx.fillText('FIT 0:00', x0 + 3, fitBlockTop - 2);
    }

    if (fitDur > 0) {
      const endMs = Math.min(videoDurationMs, fitOffsetMs + fitDur);
      const endLabel = formatVideoTime(endMs - fitOffsetMs);
      ctx.fillStyle = 'rgba(61,220,151,0.55)';
      ctx.font = '400 9px JetBrains Mono, ui-monospace, monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(endLabel, xAt(endMs) + 2, fitLanesTop + fitBlockH + 2);
    }

    const px = xAt(playheadMs);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, PAD.t);
    ctx.lineTo(px, h - PAD.b);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '400 10px JetBrains Mono, ui-monospace, monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('0:00', PAD.l, h - 6);
    const endLabel = formatVideoTime(videoDurationMs);
    const tw = ctx.measureText(endLabel).width;
    ctx.fillText(endLabel, width - PAD.r - tw, h - 6);
  }, [
    fitOffsetMs,
    fitSignals,
    fitTrack.frames,
    layout,
    playheadMs,
    videoDurationMs,
    width,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pxPerMs = width > 0 ? (width - PAD.l - PAD.r) / videoDurationMs : 0;

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const { fitBlockTop, fitLanesTop, fitBlockH } = layout;
    if (y < fitBlockTop || y > fitLanesTop + fitBlockH) return;
    dragRef.current = { startX: e.clientX, startOffset: fitOffsetMs };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || pxPerMs <= 0) return;
    const deltaMs = Math.round((e.clientX - d.startX) / pxPerMs);
    const next = clamp(d.startOffset + deltaMs, offsetRange.min, offsetRange.max);
    onOffsetChange(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div className="border-t border-white/5 px-3 py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="field-label">Manual sync</div>
          <p className="text-xs text-white/45 mt-1 max-w-xl leading-relaxed">
            Offset is where the FIT file&apos;s <span className="text-white/70">t=0</span> sits on
            the video timeline. Drag the FIT block so <span className="text-white/70">FIT 0:00</span>{' '}
            lines up with the matching moment in the video — use whichever signal (speed, HR, power, …)
            has the clearest features.
          </p>
        </div>
        <div className="text-right text-xs font-mono shrink-0">
          <div className="text-white/40">FIT offset</div>
          <div className="text-accent">{formatOffsetMs(fitOffsetMs)}</div>
          <div className="text-white/30 mt-1">({fitOffsetMs} ms)</div>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="w-full rounded-md bg-black/30 border border-white/5 overflow-y-auto max-h-[40vh]"
      >
        <canvas
          ref={canvasRef}
          className="block w-full touch-none cursor-ew-resize"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-white/50">
        <div className="rounded bg-white/[0.03] px-2 py-1.5">
          <span className="text-white/30">video </span>
          {formatVideoTime(playheadMs)}
        </div>
        <div className="rounded bg-white/[0.03] px-2 py-1.5">
          <span className="text-white/30">fit t </span>
          {fitLocalMs >= 0 ? formatVideoTime(fitLocalMs) : '— (before start)'}
        </div>
      </div>

      {fitSignals.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
          {fitSignals.map((s) => (
            <div key={s.field} className="rounded bg-white/[0.03] px-2 py-1 text-white/50">
              <span style={{ color: s.color }}>{s.field}</span>
              {' '}
              {formatFieldValue(s.field, merged[s.field] as number | undefined)}
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
) {
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(PAD.l, y, plotW, ROW_H);

  ctx.fillStyle = 'rgba(61,220,151,0.08)';
  ctx.fillRect(fitX0, y, Math.max(0, fitX1 - fitX0), ROW_H);
  ctx.strokeStyle = 'rgba(61,220,151,0.35)';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(fitX0 + 0.5, y + 0.5, Math.max(0, fitX1 - fitX0 - 1), ROW_H - 1);
  ctx.setLineDash([]);

  const normalized = normalizeSeries(series.values);
  ctx.strokeStyle = series.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < normalized.length; i++) {
    const videoT = i * series.stepMs;
    const x = xAt(videoT);
    const v = series.values[i];
    if (v === null) {
      started = false;
      continue;
    }
    const yy = y + ROW_H - 3 - normalized[i] * (ROW_H - 6);
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
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
