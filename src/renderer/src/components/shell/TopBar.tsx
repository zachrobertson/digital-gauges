import { useProject, type WorkspaceMode } from '../../store/project';
import { projectFileLabel, projectHasSessionContent } from '../../lib/projectSession';
import { clipAtGlobalTime, totalDurationMs } from '@shared/timeline';
import { ModeTabs, MODE_HINTS } from './ModeTabs';

function fmtTimecode(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const cs = Math.floor((ms % 1000) / 10);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(cs).padStart(2, '0')}`;
}

/**
 * Persistent top bar (two rows): identity + project + file IO on top, then the
 * mode tabs, an active-mode hint, and the global transport.
 */
export function TopBar() {
  const project = useProject((s) => s.project);
  const projectFilePath = useProject((s) => s.projectFilePath);
  const mode = useProject((s) => s.workspaceMode);
  const setProject = useProject((s) => s.setProject);
  const setProjectFilePath = useProject((s) => s.setProjectFilePath);
  const resetProject = useProject((s) => s.resetProject);

  async function saveProjectToPath(path: string) {
    const { project: current } = useProject.getState();
    await window.api.saveProject(path, { ...current, updatedAt: new Date().toISOString() });
    setProjectFilePath(path);
  }
  async function saveProject() {
    if (projectFilePath) return saveProjectToPath(projectFilePath);
    return saveProjectAs();
  }
  async function saveProjectAs() {
    const path = await window.api.pickProjectSavePath(`${project.name}.dgproj`);
    if (!path) return;
    await saveProjectToPath(path);
  }
  async function loadProject() {
    const path = await window.api.pickProjectFile();
    if (!path) return;
    setProject(await window.api.loadProject(path));
    setProjectFilePath(path);
  }
  async function newProject() {
    if (projectHasSessionContent(project)) {
      if (!window.confirm('Start a new project? Your current work will be cleared.')) return;
    }
    resetProject();
    await window.api.clearDraft();
  }

  const label = projectFilePath
    ? projectFileLabel(projectFilePath) ?? projectFilePath
    : projectHasSessionContent(project)
      ? `${project.name} · unsaved`
      : 'untitled project';

  return (
    <div className="bg-bg-panel border-b border-white/[0.07]">
      {/* Row 1: identity + project + global actions */}
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <GaugeMark />
          <span className="text-sm font-semibold tracking-tight">Digital Gauges</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12.5px] text-textdim truncate">{label}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="btn-elevated text-xs" onClick={newProject}>New</button>
          <button className="btn-elevated text-xs" onClick={loadProject}>Open</button>
          <button className="btn-elevated text-xs" onClick={saveProject}>Save</button>
          <button className="btn-elevated text-xs" onClick={saveProjectAs}>Save As…</button>
        </div>
      </div>

      {/* Row 2: mode tabs + hint + transport */}
      <div className="flex items-center gap-3 px-3.5 pb-2.5">
        <ModeTabs />
        <span className="text-xs text-textfaint hidden md:inline">{MODE_HINTS[mode]}</span>
        <div className="ml-auto">
          {mode !== 'export' && <Transport />}
        </div>
      </div>
    </div>
  );
}

function Transport() {
  const clips = useProject((s) => s.project.clips);
  const playhead = useProject((s) => s.playhead);
  const playing = useProject((s) => s.playing);
  const previewStale = useProject((s) => s.previewStale);
  const trimInProgress = useProject((s) => s.trimInProgress);
  const previewBuilding = useProject((s) => s.previewBuilding);
  const setPlayhead = useProject((s) => s.setPlayhead);
  const setPlaying = useProject((s) => s.setPlaying);

  const previewFrozen = previewStale || trimInProgress || previewBuilding;
  const total = totalDurationMs(clips);
  const loc = clipAtGlobalTime(clips, playhead);
  const fps = loc?.clip.media.fps || clips[0]?.media.fps || 30;
  const frameMs = 1000 / fps;
  const disabled = clips.length === 0 || previewFrozen;

  const step = (dir: -1 | 1) => {
    if (disabled) return;
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(playhead + dir * frameMs, total)));
  };

  return (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[12.5px] text-textdim tabular-nums">{fmtTimecode(Math.min(playhead, total))}</span>
      <div className="flex items-center gap-1.5">
        <TransportBtn onClick={() => step(-1)} disabled={disabled} title="Previous frame">
          <svg width={13} height={13} viewBox="0 0 16 16" fill="currentColor"><path d="M5 3v10H4V3zM13 3v10l-7-5z" /></svg>
        </TransportBtn>
        <TransportBtn primary onClick={() => !disabled && setPlaying(!playing)} disabled={disabled} title={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width={12} height={12} viewBox="0 0 16 16" fill="currentColor"><rect x={3} y={2} width={3.5} height={12} rx={1} /><rect x={9.5} y={2} width={3.5} height={12} rx={1} /></svg>
          ) : (
            <svg width={13} height={13} viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5z" /></svg>
          )}
        </TransportBtn>
        <TransportBtn onClick={() => step(1)} disabled={disabled} title="Next frame">
          <svg width={13} height={13} viewBox="0 0 16 16" fill="currentColor"><path d="M11 3v10h1V3zM3 3v10l7-5z" /></svg>
        </TransportBtn>
      </div>
      <span className="font-mono text-[12.5px] text-textfaint tabular-nums">{fmtTimecode(total)}</span>
    </div>
  );
}

function TransportBtn({
  children, onClick, primary, disabled, title,
}: {
  children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
        primary
          ? 'w-[34px] h-[34px] bg-accent text-accent-ink hover:bg-accent/90'
          : 'w-7 h-7 bg-bg-elev text-textdim border border-white/[0.07] hover:bg-bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

function GaugeMark() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <path d="M4 16a8 8 0 0 1 16 0" stroke="rgba(255,255,255,0.16)" strokeWidth={2} strokeLinecap="round" />
      <path d="M4 16a8 8 0 0 1 11.5-7.2" stroke="#3ddc97" strokeWidth={2} strokeLinecap="round" />
      <circle cx={12} cy={16} r={1.7} fill="#3ddc97" />
    </svg>
  );
}

export type { WorkspaceMode };
