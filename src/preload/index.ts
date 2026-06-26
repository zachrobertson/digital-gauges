import { contextBridge, ipcRenderer } from 'electron';
import type { DigitalGaugesApi, ExportProgress, ExportResult, UserPluginInfo } from '../shared/types';

const api: DigitalGaugesApi = {
  pickVideoFile: () => ipcRenderer.invoke('dialog:pickVideo'),
  pickFitFile: () => ipcRenderer.invoke('dialog:pickFit'),
  pickExportPath: (defaultName) => ipcRenderer.invoke('dialog:pickExportPath', defaultName),
  pickProjectFile: () => ipcRenderer.invoke('dialog:pickProject'),
  pickProjectSavePath: (defaultName) => ipcRenderer.invoke('dialog:pickProjectSave', defaultName),

  probeVideo: (path) => ipcRenderer.invoke('video:probe', path),
  extractCameraTelemetry: (path) => ipcRenderer.invoke('telemetry:extractCamera', path),
  parseFitFile: (path) => ipcRenderer.invoke('telemetry:parseFit', path),

  saveProject: (path, project) => ipcRenderer.invoke('project:save', path, project),
  loadProject: (path) => ipcRenderer.invoke('project:load', path),

  getRecoveryInfo: () => ipcRenderer.invoke('session:getRecoveryInfo'),
  saveDraft: (project) => ipcRenderer.invoke('session:saveDraft', project),
  loadDraft: () => ipcRenderer.invoke('session:loadDraft'),
  clearDraft: () => ipcRenderer.invoke('session:clearDraft'),

  startExport: (project) => ipcRenderer.invoke('export:start', project),
  startExportSegment: (jobId, clipIndex) => ipcRenderer.invoke('export:startSegment', jobId, clipIndex),
  finishExportSegment: (jobId) => ipcRenderer.invoke('export:finishSegment', jobId),
  cancelExport: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
  onExportProgress: (handler) => {
    const listener = (_: unknown, p: ExportProgress) => handler(p);
    ipcRenderer.on('export:progress', listener);
    return () => ipcRenderer.off('export:progress', listener);
  },
  onExportDone: (handler) => {
    const listener = (_: unknown, r: ExportResult) => handler(r);
    ipcRenderer.on('export:done', listener);
    return () => ipcRenderer.off('export:done', listener);
  },
  sendExportFrame: (jobId, frame) => ipcRenderer.invoke('export:frame', jobId, frame),
  finishExportFrames: (jobId) => ipcRenderer.invoke('export:finish', jobId),

  buildPreviewVideo: (segments) => ipcRenderer.invoke('preview:build', segments),

  listUserPlugins: () => ipcRenderer.invoke('plugins:list'),
  openUserPluginsFolder: () => ipcRenderer.invoke('plugins:openFolder'),
  installExampleGauge: () => ipcRenderer.invoke('plugins:installExample'),
  onUserPluginsChanged: (handler) => {
    const listener = (_: unknown, plugins: UserPluginInfo[]) => handler(plugins);
    ipcRenderer.on('plugins:changed', listener);
    return () => ipcRenderer.off('plugins:changed', listener);
  },

  listGaugeTemplates: () => ipcRenderer.invoke('templates:list'),
  saveGaugeTemplate: (template) => ipcRenderer.invoke('templates:save', template),
  loadGaugeTemplate: (id) => ipcRenderer.invoke('templates:load', id),
  deleteGaugeTemplate: (id) => ipcRenderer.invoke('templates:delete', id),
  importGaugeTemplate: () => ipcRenderer.invoke('templates:import'),
  exportGaugeTemplate: (id) => ipcRenderer.invoke('templates:export', id),
};

contextBridge.exposeInMainWorld('api', api);
