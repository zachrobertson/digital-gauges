import { useEffect, useRef } from 'react';
import { useProject } from '../../store/project';
import { allPlugins, usePlugins } from '../../store/plugins';
import { buildCourseMarkers, buildRoutePolyline, frameAtGlobalTime, type CourseMarkerPoints, type RouteScope } from '../../lib/telemetry';
import type { GpsRouteScope } from '../../gauges/gpsMiniMap';
import { isMapGaugeConfig } from '../../gauges/dataGauge';
import { withGaugeBoundsClip } from '../../gauges/common';
import { isEllipseFrame, type FrameStyleConfig } from '../../gauges/frameStyle';
import {
  panelEllipseGeometry,
  videoGaugeHandleRelPosition,
  videoGaugeResizeHandles,
} from '../../gauges/gaugeEditorLayout';
import type { GaugePlugin } from '@shared/types';

interface Props {
  width: number;
  height: number;
  /** When true, draw selection handles + drop-shadow on the selected gauge. */
  showEditorAffordances?: boolean;
  /** When true, pause RAF updates and keep the last drawn frame. */
  previewFrozen?: boolean;
}

/**
 * Live preview overlay — runs on a `requestAnimationFrame` loop and
 * redraws all placed gauges using their `renderToCanvas` function.
 *
 * The same `renderToCanvas` is reused by the export pipeline, so what
 * you see in the editor is what you get in the final MP4.
 */
export function CanvasOverlay({ width, height, showEditorAffordances, previewFrozen = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedId = useProject((s) => s.selectedGaugeId);
  const userPlugins = usePlugins((s) => s.user);

  const polylinesRef = useRef<{ full: { lat: number; lon: number }[]; video: { lat: number; lon: number }[] }>({
    full: [],
    video: [],
  });
  const courseMarkersRef = useRef<CourseMarkerPoints>({ start: null, finish: null });

  useEffect(() => {
    const syncPolylines = () => {
      const project = useProject.getState().project;
      polylinesRef.current = {
        full: buildRoutePolyline(project, 'full'),
        video: buildRoutePolyline(project, 'video'),
      };
      courseMarkersRef.current = buildCourseMarkers(project);
    };
    syncPolylines();
    return useProject.subscribe((state, prev) => {
      if (state.project.clips !== prev.project.clips
        || state.project.sharedTracks !== prev.project.sharedTracks
        || state.project.course !== prev.project.course) {
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

    if (previewFrozen) return;

    let raf = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const { project, playhead } = useProject.getState();
      const frame = frameAtGlobalTime(project, playhead);

      const plugins: GaugePlugin[] = allPlugins({
        builtins: usePlugins.getState().builtins,
        user: userPlugins,
        setUserPlugins: usePlugins.getState().setUserPlugins,
      });

      const sorted = [...project.gauges].filter((g) => g.placed !== false).sort((a, b) => a.z - b.z);

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
        if (isMapGaugeConfig(plugin.id, config)) {
          const scope = ((config as { routeScope?: GpsRouteScope }).routeScope ?? 'video') as RouteScope;
          const mapConfig = config as {
            fullTrack?: { lat: number; lon: number }[];
            courseStart?: { lat: number; lon: number } | null;
            courseFinish?: { lat: number; lon: number } | null;
          };
          mapConfig.fullTrack = polylinesRef.current[scope];
          mapConfig.courseStart = courseMarkersRef.current.start;
          mapConfig.courseFinish = courseMarkersRef.current.finish;
        }
        try {
          withGaugeBoundsClip(ctx, rect, () => {
            plugin.renderToCanvas(ctx, frame, config, rect, window.devicePixelRatio || 1);
          });
        } catch (e) {
          drawGaugeError(ctx, rect, plugin.name, (e as Error).message);
        }

        if (showEditorAffordances && g.id === selectedId) {
          const isEllipse = isEllipseFrame(config as FrameStyleConfig);
          drawSelection(ctx, rect, isEllipse);
          drawResizeHandles(ctx, g.rect, width, height, isEllipse);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [selectedId, showEditorAffordances, userPlugins, width, height, previewFrozen]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width, height }}
    />
  );
}

const HANDLE_RADIUS = 5;
const SELECTION_COLOR = '#3ddc97';

function drawSelection(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  ellipse = false,
) {
  ctx.save();
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  if (ellipse) {
    const { cx, cy, rx, ry } = panelEllipseGeometry(rect);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function drawResizeHandles(
  ctx: CanvasRenderingContext2D,
  relRect: { x: number; y: number; w: number; h: number },
  videoW: number,
  videoH: number,
  isEllipse = false,
) {
  ctx.save();
  for (const corner of videoGaugeResizeHandles(relRect, isEllipse)) {
    const p = videoGaugeHandleRelPosition(relRect, corner, isEllipse);
    const px = p.x * videoW;
    const py = p.y * videoH;
    ctx.beginPath();
    ctx.arc(px, py, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = SELECTION_COLOR;
    ctx.fill();
    ctx.strokeStyle = '#0c1014';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.stroke();
  }
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
  ctx.font = '500 12px JetBrains Mono, ui-monospace, monospace';
  ctx.fillText(`${name}: ${msg.slice(0, 80)}`, rect.x + 8, rect.y + 16);
  ctx.restore();
}
