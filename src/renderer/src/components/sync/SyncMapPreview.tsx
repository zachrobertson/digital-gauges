import { useCallback, useEffect, useRef } from 'react';
import { useProject } from '../../store/project';
import { drawGpsMapOnCanvas } from '../../gauges/gpsMapDraw';
import { buildRoutePolyline, frameAtGlobalTime } from '../../lib/telemetry';

const MAP_H = 80;

/**
 * Compact GPS route preview below the global ruler — cursor at playhead position.
 */
export function SyncMapPreview() {
  const project = useProject((s) => s.project);
  const selectedClipId = useProject((s) => s.selectedClipId);
  const playhead = useProject((s) => s.playhead);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selectedClip = project.clips.find((c) => c.id === selectedClipId) ?? project.clips[0] ?? null;
  if (!selectedClip) return null;

  const localFit = selectedClip.localTracks.find((t) => t.source === 'fit');
  const sharedFit = project.sharedTracks.find((t) => t.source === 'fit');
  const fitTrack = localFit ?? sharedFit;

  const fitHasGps = Boolean(
    fitTrack?.fields.includes('lat') && fitTrack?.fields.includes('lon'),
  );
  if (!fitHasGps) return null;

  const draw = useCallback(() => {
    const cvs = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cvs || !wrap) return;

    const w = wrap.clientWidth;
    if (w <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    cvs.width = Math.floor(w * dpr);
    cvs.height = Math.floor(MAP_H * dpr);
    cvs.style.width = `${w}px`;
    cvs.style.height = `${MAP_H}px`;

    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, MAP_H);

    const route = buildRoutePolyline(project, 'full');
    const frame = frameAtGlobalTime(project, playhead);
    const lat = typeof frame.lat === 'number' ? frame.lat : undefined;
    const lon = typeof frame.lon === 'number' ? frame.lon : undefined;

    drawGpsMapOnCanvas(
      ctx,
      { x: 0, y: 0, w, h: MAP_H },
      route,
      lat,
      lon,
      'rgba(61,220,151,0.65)',
      '#fbbf24',
      Math.min(w, MAP_H),
    );
  }, [project, playhead]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div ref={wrapRef} className="px-3 py-1 border-b border-white/5">
      <div className="text-[10px] text-white/40 mb-0.5">GPS route · playhead position</div>
      <canvas ref={canvasRef} className="block w-full rounded bg-black/30" />
    </div>
  );
}
