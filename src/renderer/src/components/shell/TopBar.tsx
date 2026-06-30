import { useState } from 'react';
import { useProject, type WorkspaceMode } from '../../store/project';
import {
  DEFAULT_PROJECT_NAME,
  isDefaultProjectName,
  projectHasSessionContent,
  projectNameFromPath,
} from '../../lib/projectSession';
import { ModeTabs } from './ModeTabs';
import { FileMenu } from './FileMenu';
import { SettingsMenu } from './SettingsMenu';
import { NamePromptDialog } from '../NamePromptDialog';

type OpenMenu = 'file' | 'settings' | null;

/** Persistent top bar: app menus (File / Settings) and workspace tabs. */
export function TopBar() {
  const project = useProject((s) => s.project);
  const projectFilePath = useProject((s) => s.projectFilePath);
  const setProject = useProject((s) => s.setProject);
  const setProjectFilePath = useProject((s) => s.setProjectFilePath);
  const setProjectName = useProject((s) => s.setProjectName);
  const resetProject = useProject((s) => s.resetProject);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [saveNamePromptOpen, setSaveNamePromptOpen] = useState(false);

  const displayName = projectFilePath
    ? projectNameFromPath(projectFilePath)
    : project.name;

  function defaultSaveName(): string {
    if (projectFilePath) return projectNameFromPath(projectFilePath);
    if (!isDefaultProjectName(project.name)) return project.name;
    return DEFAULT_PROJECT_NAME;
  }

  async function saveProjectToPath(path: string) {
    const { project: current } = useProject.getState();
    const name = projectNameFromPath(path);
    const updated = { ...current, name, updatedAt: new Date().toISOString() };
    await window.api.saveProject(path, updated);
    setProjectName(name);
    setProjectFilePath(path);
  }

  async function saveProject() {
    if (projectFilePath) return saveProjectToPath(projectFilePath);
    return saveProjectAs();
  }

  function saveProjectAs() {
    setSaveNamePromptOpen(true);
  }

  async function confirmSaveAs(name: string) {
    setSaveNamePromptOpen(false);
    const path = await window.api.pickProjectSavePath(`${name}.dgproj`);
    if (!path) return;
    await saveProjectToPath(path);
  }

  async function loadProject() {
    const path = await window.api.pickProjectFile();
    if (!path) return;
    const loaded = await window.api.loadProject(path);
    setProject({ ...loaded, name: projectNameFromPath(path) });
    setProjectFilePath(path);
  }

  async function newProject() {
    if (projectHasSessionContent(project)) {
      if (!window.confirm('Start a new project? Your current work will be cleared.')) return;
    }
    resetProject();
    await window.api.clearDraft();
  }

  return (
    <>
      <div className="bg-bg-panel border-b border-white/[0.07]">
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <FileMenu
            open={openMenu === 'file'}
            onOpenChange={(o) => setOpenMenu(o ? 'file' : null)}
            onNew={() => void newProject()}
            onOpen={() => void loadProject()}
            onSave={() => void saveProject()}
            onSaveAs={() => saveProjectAs()}
          />
          <SettingsMenu
            open={openMenu === 'settings'}
            onOpenChange={(o) => setOpenMenu(o ? 'settings' : null)}
          />
          <div className="w-px h-4 bg-white/10 mx-1" />
          <ModeTabs />
          <span
            className="ml-auto text-sm text-textdim truncate max-w-[min(40vw,20rem)]"
            title={displayName}
          >
            {displayName}
          </span>
        </div>
      </div>
      <NamePromptDialog
        open={saveNamePromptOpen}
        title="Save project"
        label="Project name"
        placeholder="My ride"
        defaultValue={defaultSaveName()}
        confirmLabel="Choose location…"
        dismissOnBackdropClick
        onConfirm={(value) => void confirmSaveAs(value)}
        onCancel={() => setSaveNamePromptOpen(false)}
      />
    </>
  );
}

export type { WorkspaceMode };
