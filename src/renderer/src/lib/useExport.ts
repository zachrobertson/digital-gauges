import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '../store/project';
import { allPlugins } from '../store/plugins';
import { buildRoutePolyline, frameAtVideoTime, type RouteScope } from './telemetry';
import type { GpsRouteScope } from '../gauges/gpsMiniMap';
import { isMapGaugeConfig } from '../gauges/dataGauge';
import { withGaugeBoundsClip } from '../gauges/common';
import type { GaugePlugin, Project } from '@shared/types';

/**
 * Renderer-side export driver.
 *
 *   1. Asks the main process for an output path.
 *   2. Patches the project with that path + calls export:start.
 *   3. Renders every frame on an OffscreenCanvas at the project's
 *      target fps using the same `renderToCanvas` functions the live
 *      preview uses.
 *   4. Reads the RGBA pixel buffer for each frame and streams it to
 *      the main process via export:frame (one IPC call per frame).
 *      Main pipes each frame into ffmpeg stdin — no temp overlay file.
 *   5. Calls export:finish to close the pipe; waits for export:done.
 */
export function useExport() {
  const project = useProject((s) => s.project);
  const setExport = useProject((s) => s.setExport);
  const [progress, setProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const cancelRef = useRef<{ jobId: string | null; cancelled: boolean; reported: boolean }>({
    jobId: null,
    cancelled: false,
    reported: false,
  });

  useEffect(() => {
    const off = window.api.onExportProgress((p) => {
      setProgress((p.framesRendered / Math.max(1, p.totalFrames)) * 100);
    });
    return off;
  }, []);

  useEffect(() => {
    const off = window.api.onExportDone((r) => {
      setExporting(false);
      setProgress(0);
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

  const openExportDialog = useCallback(() => {
    if (!project.video || exporting) return;
    setExportDialogOpen(true);
  }, [project.video, exporting]);

  const startExport = useCallback(async () => {
    const { project: current } = useProject.getState();
    if (!current.video) return;
    if (exporting) return;

    setExportDialogOpen(false);

    const defaultName = (current.name || 'export') + '.mp4';
    const path = await window.api.pickExportPath(defaultName);
    if (!path) return;

    setExport({ outputPath: path });

    setExporting(true);
    setProgress(0);

    const ready: Project = { ...current, export: { ...current.export, outputPath: path } };

    const { jobId, framesExpected, width, height } = await window.api.startExport(ready);
    cancelRef.current = { jobId, cancelled: false, reported: false };

    try {
      await renderAndPipe(jobId, ready, framesExpected, width, height, cancelRef);
      await window.api.finishExportFrames(jobId);
    } catch (e) {
      console.error(e);
      cancelRef.current.reported = true;
      cancelRef.current.cancelled = true;
      setExporting(false);
      setProgress(0);
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

  return {
    startExport,
    openExportDialog,
    exportDialogOpen,
    closeExportDialog: () => setExportDialogOpen(false),
    cancel,
    progress,
    exporting,
  };
}

async function renderAndPipe(
  jobId: string,
  project: Project,
  totalFrames: number,
  width: number,
  height: number,
  cancelRef: React.MutableRefObject<{ jobId: string | null; cancelled: boolean; reported: boolean }>,
) {
  if (!project.video) throw new Error('No video');
  const w = width;
  const h = height;
  const fps = project.export.fps;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d ctx unavailable');

  const polylines = {
    full: buildRoutePolyline(project, 'full'),
    video: buildRoutePolyline(project, 'video'),
  };
  const plugins: GaugePlugin[] = allPlugins();
  const sortedGauges = [...project.gauges].sort((a, b) => a.z - b.z);

  for (let i = 0; i < totalFrames; i++) {
    if (cancelRef.current.cancelled) return;

    const tMs = Math.round((i / fps) * 1000);
    ctx.clearRect(0, 0, w, h);
    const frame = frameAtVideoTime(project, tMs);

    for (const g of sortedGauges) {
      const plugin = plugins.find((p) => p.id === g.pluginId);
      if (!plugin) continue;
      const rect = {
        x: g.rect.x * w, y: g.rect.y * h,
        w: g.rect.w * w, h: g.rect.h * h,
      };
      const config = { ...plugin.defaultConfig, ...g.config };
      if (isMapGaugeConfig(plugin.id, config)) {
        const scope = ((config as { routeScope?: GpsRouteScope }).routeScope ?? 'video') as RouteScope;
        (config as { fullTrack?: { lat: number; lon: number }[] }).fullTrack = polylines[scope];
      }
      try {
        withGaugeBoundsClip(ctx as unknown as CanvasRenderingContext2D, rect, () => {
          plugin.renderToCanvas(ctx as unknown as CanvasRenderingContext2D, frame, config, rect, 1);
        });
      } catch {
        /* ignore individual gauge errors during export */
      }
    }

    const imgData = ctx.getImageData(0, 0, w, h);
    const copy = new Uint8Array(imgData.data.byteLength);
    copy.set(imgData.data);
    await window.api.sendExportFrame(jobId, copy.buffer);

    if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}
