import { BrowserWindow, ipcMain, dialog } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { extractBrandLabel, ffprobe, parseFps, pickVideoStream, probeCreationTime, probeDurationMs } from '../extractors/ffprobe';
import { parseFitFile } from '../extractors/fit';
import {
  cancelExport,
  finishExportFrames,
  finishExportSegment,
  startExport,
  startExportSegment,
  writeExportFrame,
} from '../export/ffmpeg';
import { buildPreviewVideo, isPreviewAbortError } from '../preview/concat';
import {
  listLoadedPlugins,
  openPluginsFolder,
  installExampleGauge,
} from '../plugins/loader';
import {
  clearDraft,
  getRecoveryInfo,
  loadDraft,
  normalizeProject,
  saveDraft,
  writeSettings,
} from '../project-persistence';
import {
  deleteTemplate,
  exportTemplateToPath,
  importTemplateFromPath,
  listTemplates,
  loadTemplate,
  saveTemplate,
} from '../template-persistence';
import type {
  ExportProgress,
  ExportResult,
  GaugeTemplateFile,
  PreviewProgress,
  Project,
  TelemetryTrack,
  VideoProbe,
} from '../../shared/types';

/** Aborts the currently in-flight preview build so a superseding build can take over. */
let previewBuildAbort: AbortController | null = null;

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dialog:pickVideo', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Pick ride videos',
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'insv', 'mkv', 'm4v'] },
        { name: 'All', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('dialog:pickFit', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Pick a FIT file from your bike computer',
      filters: [{ name: 'FIT', extensions: ['fit'] }, { name: 'All', extensions: ['*'] }],
      properties: ['openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:pickExportPath', async (_e, defaultName: string) => {
    const win = getWindow();
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export burned-in video',
      defaultPath: defaultName,
      filters: [{ name: 'MP4', extensions: ['mp4'] }, { name: 'MOV', extensions: ['mov'] }],
    });
    return res.canceled ? null : res.filePath ?? null;
  });

  ipcMain.handle('dialog:pickProject', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Open project',
      filters: [{ name: 'Digital Gauges Project', extensions: ['dgproj', 'json'] }],
      properties: ['openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:pickProjectSave', async (_e, defaultName: string) => {
    const win = getWindow();
    const res = await dialog.showSaveDialog(win!, {
      title: 'Save project',
      defaultPath: defaultName,
      filters: [{ name: 'Digital Gauges Project', extensions: ['dgproj'] }],
    });
    return res.canceled ? null : res.filePath ?? null;
  });

  ipcMain.handle('video:probe', async (_e, path: string): Promise<VideoProbe> => {
    const probe = await ffprobe(path).catch(() => null);

    const videoStream = probe ? pickVideoStream(probe) : null;
    const durationMs = probe ? probeDurationMs(probe) : 0;

    return {
      path,
      width: videoStream?.width ?? 0,
      height: videoStream?.height ?? 0,
      durationMs,
      fps: parseFps(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate),
      creationTime: probe ? probeCreationTime(probe) : undefined,
      detectedBrand: probe ? extractBrandLabel(probe) : null,
      rawProbe: probe,
    };
  });

  ipcMain.handle('telemetry:parseFit', async (_e, path: string): Promise<TelemetryTrack> => {
    return parseFitFile(path);
  });

  ipcMain.handle('project:save', async (_e, path: string, project: Project) => {
    const normalized = normalizeProject(project);
    await writeFile(path, JSON.stringify(normalized, null, 2), 'utf8');
    await writeSettings({ lastProjectPath: path });
  });

  ipcMain.handle('project:load', async (_e, path: string): Promise<Project> => {
    const raw = await readFile(path, 'utf8');
    const project = normalizeProject(JSON.parse(raw));
    await writeSettings({ lastProjectPath: path });
    return project;
  });

  ipcMain.handle('session:getRecoveryInfo', () => getRecoveryInfo());
  ipcMain.handle('session:saveDraft', async (_e, project: Project) => {
    await saveDraft(project);
  });
  ipcMain.handle('session:loadDraft', () => loadDraft());
  ipcMain.handle('session:clearDraft', () => clearDraft());

  ipcMain.handle('export:start', async (_e, project: Project) => {
    const win = getWindow();
    const startedAt = Date.now();
    const exportJob = await startExport(
      project,
      (frameIdx, total) => {
        if (!win || win.isDestroyed()) return;
        const elapsed = (Date.now() - startedAt) / 1000;
        const fps = elapsed > 0 ? frameIdx / elapsed : 0;
        const eta = fps > 0 ? (total - frameIdx) / fps : 0;
        const progress: ExportProgress = {
          jobId: exportJob.jobId,
          framesRendered: frameIdx,
          totalFrames: total,
          fps,
          etaSeconds: eta,
        };
        win.webContents.send('export:progress', progress);
      },
      (result) => {
        if (!win || win.isDestroyed()) return;
        const out: ExportResult = {
          jobId: exportJob.jobId,
          ok: result.ok,
          outputPath: result.outputPath,
          error: result.error,
        };
        win.webContents.send('export:done', out);
      },
    );
    return exportJob;
  });

  ipcMain.handle('export:startSegment', async (_e, jobId: string, clipIndex: number) => {
    return startExportSegment(jobId, clipIndex);
  });

  ipcMain.handle('export:finishSegment', async (_e, jobId: string) => {
    await finishExportSegment(jobId);
  });

  ipcMain.handle('export:cancel', async (_e, jobId: string) => {
    cancelExport(jobId);
  });

  ipcMain.handle('export:frame', async (_e, jobId: string, frame: ArrayBuffer) => {
    await writeExportFrame(jobId, frame);
  });

  ipcMain.handle('export:finish', async (_e, jobId: string) => {
    await finishExportFrames(jobId);
  });

  ipcMain.handle('preview:build', async (_e, segments: import('../../shared/types/ipc').PreviewSegment[]) => {
    // Supersede any in-flight preview build — abort it so its ffmpeg is killed
    // instead of running to completion for a now-stale timeline.
    previewBuildAbort?.abort();
    const controller = new AbortController();
    previewBuildAbort = controller;
    const win = getWindow();
    const onProgress = (progress: PreviewProgress): void => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send('preview:progress', progress);
    };
    try {
      const path = await buildPreviewVideo(segments, { signal: controller.signal, onProgress });
      return { path };
    } catch (err) {
      // A superseded/cancelled build is expected, not a failure — report it as
      // cancelled instead of surfacing it as an unhandled handler error.
      if (isPreviewAbortError(err)) return { path: '', cancelled: true };
      throw err;
    } finally {
      if (previewBuildAbort === controller) previewBuildAbort = null;
    }
  });

  ipcMain.handle('preview:cancel', async () => {
    previewBuildAbort?.abort();
    previewBuildAbort = null;
  });

  ipcMain.handle('plugins:list', () => listLoadedPlugins());
  ipcMain.handle('plugins:openFolder', () => openPluginsFolder());
  ipcMain.handle('plugins:installExample', () => installExampleGauge());

  ipcMain.handle('templates:list', () => listTemplates());
  ipcMain.handle('templates:save', async (_e, template: GaugeTemplateFile) => saveTemplate(template));
  ipcMain.handle('templates:load', async (_e, id: string) => loadTemplate(id));
  ipcMain.handle('templates:delete', async (_e, id: string) => {
    await deleteTemplate(id);
  });
  ipcMain.handle('templates:import', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Import gauge template',
      filters: [{ name: 'Gauge template', extensions: ['dgtemplate.json', 'json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return importTemplateFromPath(res.filePaths[0]);
  });
  ipcMain.handle('templates:export', async (_e, id: string) => {
    const win = getWindow();
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export gauge template',
      filters: [{ name: 'Gauge template', extensions: ['dgtemplate.json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await exportTemplateToPath(id, res.filePath);
    return res.filePath;
  });
}
