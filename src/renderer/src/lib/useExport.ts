import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '../store/project';
import { allPlugins } from '../store/plugins';
import { buildCourseMarkers, buildRoutePolyline, frameAtClipLocalTime, frameAtGlobalTime, type RouteScope } from './telemetry';
import { projectDurationMs } from '@shared/timeline';
import type { GpsRouteScope } from '../gauges/gpsMiniMap';
import { isMapGaugeConfig } from '../gauges/dataGauge';
import { ensureFontsLoaded } from './fonts';
import { withGaugeBoundsClip } from '../gauges/common';
import type { GaugePlugin, Project } from '@shared/types';

/**
 * Renderer-side export driver — supports single-clip and multi-clip (segment + concat) export.
 */
export function useExport() {
  const project = useProject((s) => s.project);
  const setExport = useProject((s) => s.setExport);
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState<{ framesRendered: number; totalFrames: number }>({
    framesRendered: 0,
    totalFrames: 0,
  });
  const [exporting, setExporting] = useState(false);
  const startedAtRef = useRef<number>(0);
  const lastFramesRef = useRef(0);
  const cancelRef = useRef<{ jobId: string | null; cancelled: boolean; reported: boolean }>({
    jobId: null,
    cancelled: false,
    reported: false,
  });

  useEffect(() => {
    const off = window.api.onExportProgress((p) => {
      const framesRendered = Math.max(lastFramesRef.current, p.framesRendered);
      lastFramesRef.current = framesRendered;
      setProgress((framesRendered / Math.max(1, p.totalFrames)) * 100);
      setProgressDetail({ framesRendered, totalFrames: p.totalFrames });
    });
    return off;
  }, []);

  useEffect(() => {
    const off = window.api.onExportDone((r) => {
      setExporting(false);
      setProgress(0);
      lastFramesRef.current = 0;
      setProgressDetail({ framesRendered: 0, totalFrames: 0 });
      cancelRef.current.jobId = null;
      if (cancelRef.current.reported) {
        cancelRef.current.reported = false;
        return;
      }
      if (r.ok) {
        alert(`Export complete: ${r.outputPath}`);
      } else {
        alert(`Export failed: ${r.error ?? 'unknown error'}`);
      }
    });
    return off;
  }, []);

  const startExport = useCallback(async () => {
    const { project: current } = useProject.getState();
    if (current.clips.length === 0) return;
    if (exporting) return;

    const defaultName = (current.name || 'export') + '.mp4';
    const path = await window.api.pickExportPath(defaultName);
    if (!path) return;

    setExport({ outputPath: path });

    setExporting(true);
    setProgress(0);
    lastFramesRef.current = 0;
    setProgressDetail({ framesRendered: 0, totalFrames: 0 });
    startedAtRef.current = Date.now();

    // Ensure bundled gauge fonts are rasterized so burned-in text matches the
    // live preview from the very first frame.
    await ensureFontsLoaded();

    const ready: Project = { ...current, export: { ...current.export, outputPath: path } };

    const { jobId, framesExpected, width, height, segmentCount } = await window.api.startExport(ready);
    cancelRef.current = { jobId, cancelled: false, reported: false };

    try {
      if (ready.overlays.length > 0) {
        await renderAndPipeComposite(jobId, ready, framesExpected, width, height, cancelRef);
      } else if (segmentCount <= 1) {
        await renderAndPipeSingle(jobId, ready, framesExpected, width, height, cancelRef);
      } else {
        await renderAndPipeMulti(jobId, ready, width, height, segmentCount, cancelRef);
      }
      await window.api.finishExportFrames(jobId);
    } catch (e) {
      console.error(e);
      cancelRef.current.reported = true;
      cancelRef.current.cancelled = true;
      setExporting(false);
      setProgress(0);
      lastFramesRef.current = 0;
      alert(`Export failed: ${(e as Error).message}`);
      await window.api.cancelExport(jobId);
    }
  }, [setExport, exporting]);

  const cancel = useCallback(async () => {
    const id = cancelRef.current.jobId;
    if (!id) return;
    cancelRef.current.cancelled = true;
    await window.api.cancelExport(id);
  }, []);

  /** Elapsed ms since the current export started (0 when idle). */
  const elapsedMs = exporting && startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0;

  return {
    startExport,
    cancel,
    progress,
    progressDetail,
    exporting,
    startedAt: startedAtRef.current,
    elapsedMs,
  };
}

async function renderAndPipeComposite(
  jobId: string,
  project: Project,
  totalFrames: number,
  width: number,
  height: number,
  cancelRef: React.MutableRefObject<{ jobId: string | null; cancelled: boolean; reported: boolean }>,
) {
  const fps = project.export.fps;
  const durationMs = projectDurationMs(project.clips, project.overlays);
  await renderClipFrames(
    jobId,
    project,
    project.clips[0]!,
    totalFrames,
    width,
    height,
    fps,
    cancelRef,
    (i) => {
      const globalMs = Math.min(durationMs, Math.round((i / fps) * 1000));
      return frameAtGlobalTime(project, globalMs);
    },
  );
}

async function renderAndPipeSingle(
  jobId: string,
  project: Project,
  totalFrames: number,
  width: number,
  height: number,
  cancelRef: React.MutableRefObject<{ jobId: string | null; cancelled: boolean; reported: boolean }>,
) {
  const clip = project.clips[0];
  if (!clip) throw new Error('No clips');
  await renderClipFrames(jobId, project, clip, totalFrames, width, height, project.export.fps, cancelRef, (i, fps) => {
    const localMs = Math.round((i / fps) * 1000);
    return frameAtClipLocalTime(project, clip, localMs);
  });
}

async function renderAndPipeMulti(
  jobId: string,
  project: Project,
  width: number,
  height: number,
  segmentCount: number,
  cancelRef: React.MutableRefObject<{ jobId: string | null; cancelled: boolean; reported: boolean }>,
) {
  const fps = project.export.fps;

  for (let clipIndex = 0; clipIndex < segmentCount; clipIndex++) {
    if (cancelRef.current.cancelled) return;
    const clip = project.clips[clipIndex];
    if (!clip) throw new Error(`Missing clip ${clipIndex}`);

    const { framesExpected } = await window.api.startExportSegment(jobId, clipIndex);
    await renderClipFrames(
      jobId,
      project,
      clip,
      framesExpected,
      width,
      height,
      fps,
      cancelRef,
      (i, exportFps) => {
        const localMs = Math.round((i / exportFps) * 1000);
        return frameAtClipLocalTime(project, clip, localMs);
      },
    );
    await window.api.finishExportSegment(jobId);
  }
}

async function renderClipFrames(
  jobId: string,
  project: Project,
  _clip: Project['clips'][number],
  totalFrames: number,
  width: number,
  height: number,
  fps: number,
  cancelRef: React.MutableRefObject<{ jobId: string | null; cancelled: boolean; reported: boolean }>,
  sampleFrame: (frameIndex: number, fps: number) => ReturnType<typeof frameAtGlobalTime>,
) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d ctx unavailable');

  const polylines = {
    full: buildRoutePolyline(project, 'full'),
    video: buildRoutePolyline(project, 'video'),
  };
  const courseMarkers = buildCourseMarkers(project);
  const plugins: GaugePlugin[] = allPlugins();
  const sortedGauges = [...project.gauges].filter((g) => g.placed !== false).sort((a, b) => a.z - b.z);

  for (let i = 0; i < totalFrames; i++) {
    if (cancelRef.current.cancelled) return;

    ctx.clearRect(0, 0, width, height);
    const frame = sampleFrame(i, fps);

    for (const g of sortedGauges) {
      const plugin = plugins.find((p) => p.id === g.pluginId);
      if (!plugin) continue;
      const rect = {
        x: g.rect.x * width, y: g.rect.y * height,
        w: g.rect.w * width, h: g.rect.h * height,
      };
      const config = { ...plugin.defaultConfig, ...g.config };
      if (isMapGaugeConfig(plugin.id, config)) {
        const scope = ((config as { routeScope?: GpsRouteScope }).routeScope ?? 'video') as RouteScope;
        const mapConfig = config as {
          fullTrack?: { lat: number; lon: number }[];
          courseStart?: { lat: number; lon: number } | null;
          courseFinish?: { lat: number; lon: number } | null;
        };
        mapConfig.fullTrack = polylines[scope];
        mapConfig.courseStart = courseMarkers.start;
        mapConfig.courseFinish = courseMarkers.finish;
      }
      try {
        withGaugeBoundsClip(ctx as unknown as CanvasRenderingContext2D, rect, () => {
          plugin.renderToCanvas(ctx as unknown as CanvasRenderingContext2D, frame, config, rect, 1);
        });
      } catch {
        /* ignore individual gauge errors during export */
      }
    }

    const imgData = ctx.getImageData(0, 0, width, height);
    const copy = new Uint8Array(imgData.data.byteLength);
    copy.set(imgData.data);
    await window.api.sendExportFrame(jobId, copy.buffer);

    if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}
