import type { GaugeTemplateFile, GaugeTemplateSummary } from './gaugeTemplate';
import type { Project } from './project';
import type { TelemetryTrack } from './telemetry';

export type { GaugeTemplateFile, GaugeTemplateSummary };

/**
 * IPC channel contract — the renderer talks to the main process only
 * through these channels. The preload script exposes a typed `api`
 * object that maps 1:1 to this interface.
 */
export interface DigitalGaugesApi {
  pickVideoFile(): Promise<string | null>;
  pickFitFile(): Promise<string | null>;
  pickExportPath(defaultName: string): Promise<string | null>;
  pickProjectFile(): Promise<string | null>;
  pickProjectSavePath(defaultName: string): Promise<string | null>;

  probeVideo(path: string): Promise<VideoProbe>;
  extractCameraTelemetry(path: string): Promise<TelemetryTrack>;
  parseFitFile(path: string): Promise<TelemetryTrack>;

  saveProject(path: string, project: Project): Promise<void>;
  loadProject(path: string): Promise<Project>;

  getRecoveryInfo(): Promise<RecoveryInfo>;
  saveDraft(project: Project): Promise<void>;
  loadDraft(): Promise<Project | null>;
  clearDraft(): Promise<void>;

  startExport(project: Project): Promise<ExportStartResult>;
  cancelExport(jobId: string): Promise<void>;
  onExportProgress(handler: (p: ExportProgress) => void): () => void;
  onExportDone(handler: (r: ExportResult) => void): () => void;

  /** Renderer streams raw RGBA frames into the export pipeline. */
  sendExportFrame(jobId: string, frame: ArrayBuffer): Promise<void>;
  finishExportFrames(jobId: string): Promise<void>;

  listUserPlugins(): Promise<UserPluginInfo[]>;
  openUserPluginsFolder(): Promise<void>;
  installExampleGauge(): Promise<{ ok: boolean; path?: string; alreadyExists?: boolean; error?: string }>;
  onUserPluginsChanged(handler: (plugins: UserPluginInfo[]) => void): () => void;

  listGaugeTemplates(): Promise<GaugeTemplateSummary[]>;
  saveGaugeTemplate(template: GaugeTemplateFile): Promise<GaugeTemplateFile>;
  loadGaugeTemplate(id: string): Promise<GaugeTemplateFile | null>;
  deleteGaugeTemplate(id: string): Promise<void>;
  importGaugeTemplate(): Promise<GaugeTemplateFile | null>;
  exportGaugeTemplate(id: string): Promise<string | null>;
}

export interface VideoProbe {
  path: string;
  width: number;
  height: number;
  durationMs: number;
  fps: number;
  /** ISO 8601 UTC from container creation_time, when present. */
  creationTime?: string;
  detectedBrand: string | null;
  cameraExtractorId: string | null;
  rawProbe: unknown;
}

export interface ExportStartResult {
  jobId: string;
  framesExpected: number;
  width: number;
  height: number;
  durationMs: number;
}

export interface ExportProgress {
  jobId: string;
  framesRendered: number;
  totalFrames: number;
  fps: number;
  etaSeconds: number;
}

export interface ExportResult {
  jobId: string;
  ok: boolean;
  outputPath?: string;
  error?: string;
}

export interface RecoveryInfo {
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  lastProjectPath: string | null;
  lastProjectExists: boolean;
}

/** Metadata for a user-authored `.gauge.tsx` file. */
export interface UserPluginInfo {
  pluginId: string;
  filePath: string;
  name: string;
  /** Transpiled JS module url the renderer can `import()` via `user-gauge:` protocol. */
  moduleUrl: string;
  loadedAt: string;
  error?: string;
}
