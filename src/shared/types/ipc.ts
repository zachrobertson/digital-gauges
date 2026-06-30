import type { GaugeTemplateFile, GaugeTemplateSummary } from './gaugeTemplate';
import type { Project } from './project';
import type { TelemetryTrack } from './telemetry';
import type { AppSettings } from './settings';

export type { GaugeTemplateFile, GaugeTemplateSummary };

/**
 * IPC channel contract — the renderer talks to the main process only
 * through these channels. The preload script exposes a typed `api`
 * object that maps 1:1 to this interface.
 */
export type PreviewProgressPhase = 'probing' | 'encoding' | 'concat' | 'done';

export interface PreviewProgress {
  phase: PreviewProgressPhase;
  /** Overall completion, 0–100. */
  percent: number;
  /** 0-based clip index during the encoding phase. */
  clipIndex?: number;
  clipCount?: number;
  /** Progress within the current clip encode, 0–100. */
  clipPercent?: number;
  message: string;
}

export interface DigitalGaugesApi {
  pickVideoFile(): Promise<string[]>;
  pickFitFile(): Promise<string | null>;
  pickExportPath(defaultName: string): Promise<string | null>;
  pickProjectFile(): Promise<string | null>;
  pickProjectSavePath(defaultName: string): Promise<string | null>;

  probeVideo(path: string): Promise<VideoProbe>;
  parseFitFile(path: string): Promise<TelemetryTrack>;

  saveProject(path: string, project: Project): Promise<void>;
  loadProject(path: string): Promise<Project>;

  getRecoveryInfo(): Promise<RecoveryInfo>;
  saveDraft(project: Project, filePath: string | null): Promise<void>;
  loadDraft(): Promise<DraftPayload | null>;
  clearDraft(): Promise<void>;

  getAppSettings(): Promise<AppSettings>;
  updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  startExport(project: Project): Promise<ExportStartResult>;
  startExportSegment(jobId: string, clipIndex: number): Promise<{ framesExpected: number }>;
  finishExportSegment(jobId: string): Promise<void>;
  cancelExport(jobId: string): Promise<void>;
  onExportProgress(handler: (p: ExportProgress) => void): () => void;
  onExportDone(handler: (r: ExportResult) => void): () => void;

  /** Renderer streams raw RGBA frames into the export pipeline. */
  sendExportFrame(jobId: string, frame: ArrayBuffer): Promise<void>;
  finishExportFrames(jobId: string): Promise<void>;

  /** Build one preview file (trim + concat as needed) for playback. `cancelled` is set when superseded. */
  buildPreviewVideo(segments: PreviewSegment[]): Promise<{ path: string; cancelled?: boolean }>;
  /** Abort the in-flight preview build (e.g. when the timeline changed mid-build). */
  cancelPreviewBuild(): Promise<void>;
  onPreviewProgress(handler: (p: PreviewProgress) => void): () => void;

  listUserPlugins(): Promise<UserPluginInfo[]>;
  openUserPluginsFolder(): Promise<void>;
  onUserPluginsChanged(handler: (plugins: UserPluginInfo[]) => void): () => void;

  listGaugeTemplates(): Promise<GaugeTemplateSummary[]>;
  saveGaugeTemplate(template: GaugeTemplateFile): Promise<GaugeTemplateFile>;
  loadGaugeTemplate(id: string): Promise<GaugeTemplateFile | null>;
  deleteGaugeTemplate(id: string): Promise<void>;
  importGaugeTemplate(): Promise<GaugeTemplateFile | null>;
  exportGaugeTemplate(id: string): Promise<string | null>;
}

/** One clip segment for the preview builder, with trim window (source ms). */
export interface PreviewSegment {
  path: string;
  inMs: number;
  outMs: number;
  durationMs: number;
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
  rawProbe: unknown;
}

export interface ExportStartResult {
  jobId: string;
  framesExpected: number;
  width: number;
  height: number;
  durationMs: number;
  segmentCount: number;
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

/** Autosaved session draft plus the .dgproj path it was associated with (if any). */
export interface DraftPayload {
  /** Source project file the draft belongs to, or null for a never-saved project. */
  filePath: string | null;
  project: Project;
}

export interface RecoveryInfo {
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  /** The .dgproj path the autosaved draft was associated with, if any. */
  draftFilePath: string | null;
  /** Whether `draftFilePath` still exists on disk. */
  draftFileExists: boolean;
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
