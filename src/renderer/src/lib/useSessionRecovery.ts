import { useEffect, useRef } from 'react';
import { useProject } from '../store/project';
import { projectFileLabel } from './projectSession';

/**
 * On first launch, offer to restore an autosaved draft or reopen the last project.
 */
export function useSessionRecovery() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      const info = await window.api.getRecoveryInfo();

      if (info.hasDraft) {
        const when = info.draftUpdatedAt
          ? new Date(info.draftUpdatedAt).toLocaleString()
          : 'your last session';
        const restore = window.confirm(
          `Restore unsaved work from ${when}?\n\nChoose Cancel to discard the draft and start fresh.`,
        );
        if (restore) {
          const draft = await window.api.loadDraft();
          if (draft) {
            useProject.getState().setProject(draft);
            useProject.getState().setProjectFilePath(null);
          }
          return;
        }
        await window.api.clearDraft();
      }

      if (info.lastProjectPath && info.lastProjectExists) {
        const name = projectFileLabel(info.lastProjectPath) ?? 'project';
        const reopen = window.confirm(`Reopen last project "${name}"?`);
        if (!reopen) return;
        try {
          const project = await window.api.loadProject(info.lastProjectPath);
          useProject.getState().setProject(project);
          useProject.getState().setProjectFilePath(info.lastProjectPath);
        } catch (e) {
          alert(`Could not open last project: ${(e as Error).message}`);
        }
      }
    })();
  }, []);
}
