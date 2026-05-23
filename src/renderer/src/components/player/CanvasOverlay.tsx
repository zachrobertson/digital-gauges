import { useEffect, useRef } from 'react';
import { useProject } from '../../store/project';
import { allPlugins, usePlugins } from '../../store/plugins';
import { buildRoutePolyline, frameAtVideoTime, type RouteScope } from '../../lib/telemetry';
import type { GpsRouteScope } from '../../gauges/gpsMiniMap';
import { isDataGaugePlugin, resolveDataGaugeDisplayStyle } from '../../gauges/dataGauge';
import { withGaugeBoundsClip } from '../../gauges/common';
import { panelCircleGeometry } from '../../gauges/gaugeEditorLayout';
import type { GaugePlugin } from '@shared/types';

interface Props {
  width: number;
  height: number;
  /** When true, draw selection handles + drop-shadow on the selected gauge. */
  showEditorAffordances?: boolean;
}

/**
 * Live preview overlay — runs on a `requestAnimationFrame` loop and
 * redraws all placed gauges using their `renderToCanvas` function.
 *
 * The same `renderToCanvas` is reused by the export pipeline, so what
 * you see in the editor is what you get in the final MP4.
 */
export function CanvasOverlay({ width, height, showEditorAffordances }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedId = useProject((s) => s.selectedGaugeId);
  const userPlugins = usePlugins((s) => s.user);

  const polylinesRef = useRef<{ full: { lat: number; lon: number }[]; video: { lat: number; lon: number }[] }>({
    full: [],
    video: [],
  });

  useEffect(() => {
    const syncPolylines = () => {
      const project = useProject.getState().project;
      polylinesRef.current = {
        full: buildRoutePolyline(project, 'full'),
        video: buildRoutePolyline(project, 'video'),
      };
    };
    syncPolylines();
    return useProject.subscribe((state, prev) => {
      if (state.project.tracks !== prev.project.tracks
        || state.project.trackSync !== prev.project.trackSync
        || state.project.video !== prev.project.video) {
        syncPolylines();
      }
    });
  }, []);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = Math.max(1, Math.floor(width * dpr));
    cvs.height = Math.max(1, Math.floor(height * dpr));
    cvs.style.width = `${width}px`;
    cvs.style.height = `${height}px`;
    const ctx = cvs.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [width, height]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    let raf = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const { project, playhead } = useProject.getState();
      const frame = frameAtVideoTime(project, playhead);

      const plugins: GaugePlugin[] = allPlugins({
        builtins: usePlugins.getState().builtins,
        user: userPlugins,
        setUserPlugins: usePlugins.getState().setUserPlugins,
      });

      const sorted = [...project.gauges].sort((a, b) => a.z - b.z);

      for (const g of sorted) {
        const plugin = plugins.find((p) => p.id === g.pluginId);
        if (!plugin) continue;
        const rect = {
          x: g.rect.x * width,
          y: g.rect.y * height,
          w: g.rect.w * width,
          h: g.rect.h * height,
        };
        const config = { ...plugin.defaultConfig, ...g.config };
        const isMapGauge = isDataGaugePlugin(plugin.id)
          ? resolveDataGaugeDisplayStyle(config) === 'map'
          : plugin.id === 'builtin:gpsMiniMap';
        if (isMapGauge) {
          const scope = ((config as { routeScope?: GpsRouteScope }).routeScope ?? 'video') as RouteScope;
          (config as { fullTrack?: { lat: number; lon: number }[] }).fullTrack =
            polylinesRef.current[scope];
        }
        try {
          withGaugeBoundsClip(ctx, rect, () => {
            plugin.renderToCanvas(ctx, frame, config, rect, window.devicePixelRatio || 1);
          });
        } catch (e) {
          drawGaugeError(ctx, rect, plugin.name, (e as Error).message);
        }

        if (showEditorAffordances && g.id === selectedId) {
          const isCircle = (config as { cornerStyle?: string }).cornerStyle === 'circle';
          drawSelection(ctx, rect, isCircle);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [selectedId, showEditorAffordances, userPlugins, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width, height }}
    />
  );
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  circle = false,
) {
  ctx.save();
  ctx.strokeStyle = '#3ddc97';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  if (circle) {
    const { cx, cy, r } = panelCircleGeometry(rect);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function drawGaugeError(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  name: string,
  msg: string,
) {
  ctx.save();
  ctx.fillStyle = 'rgba(239,68,68,0.85)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = '#fff';
  ctx.font = '500 12px Inter, sans-serif';
  ctx.fillText(`${name}: ${msg.slice(0, 80)}`, rect.x + 8, rect.y + 16);
  ctx.restore();
}
