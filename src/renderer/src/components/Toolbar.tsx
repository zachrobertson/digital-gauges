import { useState } from 'react';
import { useProject } from '../store/project';
import { useExport } from '../lib/useExport';
import { ExportDialog } from './ExportDialog';
import { projectFileLabel, projectHasSessionContent } from '../lib/projectSession';
import { roundExportFps } from '@shared/types';
import type { Project } from '@shared/types';

export function Toolbar() {
  const project = useProject((s) => s.project);
  const projectFilePath = useProject((s) => s.projectFilePath);
  const setProject = useProject((s) => s.setProject);
  const setProjectFilePath = useProject((s) => s.setProjectFilePath);
  const setVideo = useProject((s) => s.setVideo);
  const setExport = useProject((s) => s.setExport);
  const addTrack = useProject((s) => s.addTrack);
  const resetProject = useProject((s) => s.resetProject);
  const [loading, setLoading] = useState<string | null>(null);

  const {
    startExport,
    openExportDialog,
    exportDialogOpen,
    closeExportDialog,
    cancel,
    progress,
    exporting,
  } = useExport();

  async function loadVideo() {
    const path = await window.api.pickVideoFile();
    if (!path) return;
    setLoading('Probing video…');
    try {
      const probe = await window.api.probeVideo(path);
      setVideo({
        id: crypto.randomUUID(),
        path,
        filename: path.split(/[/\\]/).pop() ?? path,
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        creationTime: probe.creationTime,
      });
      setExport({ fps: roundExportFps(probe.fps) });
      if (probe.cameraExtractorId) {
        setLoading(`Extracting ${probe.detectedBrand ?? 'camera'} telemetry…`);
        try {
          const track = await window.api.extractCameraTelemetry(path);
          addTrack(track);
        } catch (e) {
          alert(`Telemetry extraction failed: ${(e as Error).message}`);
        }
      }
    } finally {
      setLoading(null);
    }
  }

  async function loadFit() {
    const path = await window.api.pickFitFile();
    if (!path) return;
    setLoading('Parsing FIT…');
    try {
      const track = await window.api.parseFitFile(path);
      addTrack(track);
    } catch (e) {
      alert(`FIT parse failed: ${(e as Error).message}`);
    } finally {
      setLoading(null);
    }
  }

  async function saveProjectToPath(path: string) {
    const { project: current } = useProject.getState();
    const toSave = { ...current, updatedAt: new Date().toISOString() };
    await window.api.saveProject(path, toSave);
    setProjectFilePath(path);
  }

  async function saveProject() {
    if (projectFilePath) {
      await saveProjectToPath(projectFilePath);
      return;
    }
    await saveProjectAs();
  }

  async function saveProjectAs() {
    const path = await window.api.pickProjectSavePath(`${project.name}.dgproj`);
    if (!path) return;
    await saveProjectToPath(path);
  }

  async function loadProject() {
    const path = await window.api.pickProjectFile();
    if (!path) return;
    const p = await window.api.loadProject(path);
    setProject(p);
    setProjectFilePath(path);
  }

  async function newProject() {
    if (projectHasSessionContent(project)) {
      const ok = window.confirm('Start a new project? Your current work will be cleared.');
      if (!ok) return;
    }
    resetProject();
    await window.api.clearDraft();
  }

  return (
    <div className="panel flex items-center gap-2 px-3 py-2 border-b border-white/5">
      <div className="font-semibold mr-3">Digital Gauges</div>

      <button className="btn-ghost" onClick={loadVideo}>Load video…</button>
      <button className="btn-ghost" onClick={loadFit}>Load FIT…</button>

      <div className="mx-2 h-5 w-px bg-white/10" />

      <button className="btn-ghost" onClick={loadProject}>Open…</button>
      <button className="btn-ghost" onClick={saveProject}>Save</button>
      <button className="btn-ghost" onClick={saveProjectAs}>Save As…</button>
      <button className="btn-ghost" onClick={newProject}>New</button>

      <div className="mx-2 h-5 w-px bg-white/10" />

      <button
        className="btn-primary"
        disabled={!project.video || exporting}
        onClick={openExportDialog}
      >
        {exporting ? `Exporting ${progress.toFixed(0)}%…` : 'Export MP4'}
      </button>

      <ExportDialog
        open={exportDialogOpen}
        exporting={exporting}
        onClose={closeExportDialog}
        onExport={startExport}
        onCancelExport={cancel}
      />

      <div className="ml-auto text-xs text-white/40">
        {statusLabel(loading, project, projectFilePath)}
      </div>
    </div>
  );
}

function statusLabel(
  loading: string | null,
  project: Project,
  projectFilePath: string | null,
): string {
  if (loading) return loading;
  if (projectFilePath) return projectFileLabel(projectFilePath) ?? projectFilePath;
  if (projectHasSessionContent(project)) return 'Unsaved project (autosaved)';
  if (project.video) return project.video.filename;
  return 'no video loaded';
}
