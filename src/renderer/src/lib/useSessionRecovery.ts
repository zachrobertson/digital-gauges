import { useEffect, useRef } from 'react';
import { useProject } from '../store/project';
import { projectFileLabel } from './projectSession';

/**
 * On first launch, recover the previous session.
 *
 * The autosaved draft is the latest in-progress state and remembers the
 * `.dgproj` file it belongs to (if any), so restoring it keeps the project
 * name and file association intact. The flow is a single decision:
 *
 * - Draft for a saved project → "Restore unsaved changes to <name>?"
 *   (Cancel opens the last saved version on disk instead).
 * - Draft for a never-saved project → "Restore unsaved work?"
 *   (Cancel starts fresh).
 * - No draft, but a last project exists → "Reopen last project <name>?".
 */
export function useSessionRecovery() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      const info = await window.api.getRecoveryInfo();

      async function openSavedProject(path: string): Promise<void> {
        try {
          const project = await window.api.loadProject(path);
          useProject.getState().setProject(project);
          useProject.getState().setProjectFilePath(path);
        } catch (e) {
          alert(`Could not open project: ${(e as Error).message}`);
        }
      }

      if (info.hasDraft) {
        const draftName = info.draftFileExists && info.draftFilePath
          ? projectFileLabel(info.draftFilePath)
          : null;
        const when = info.draftUpdatedAt
          ? new Date(info.draftUpdatedAt).toLocaleString()
          : 'your last session';

        const message = draftName
          ? `Restore unsaved changes to "${draftName}"?\n\nChoose Cancel to open the last saved version instead.`
          : `Restore unsaved work from ${when}?\n\nChoose Cancel to discard the draft and start fresh.`;

        if (window.confirm(message)) {
          const draft = await window.api.loadDraft();
          if (draft) {
            useProject.getState().setProject(draft.project);
            // Re-associate with the source file so the name shows and Save
            // overwrites it — unless that file has since gone missing.
            useProject.getState().setProjectFilePath(
              info.draftFileExists ? draft.filePath : null,
            );
          }
          return;
        }

        // Declined to keep unsaved changes: drop the draft and fall back to the
        // clean saved version of the same project when we still have it.
        await window.api.clearDraft();
        if (info.draftFileExists && info.draftFilePath) {
          await openSavedProject(info.draftFilePath);
        }
        return;
      }

      if (info.lastProjectPath && info.lastProjectExists) {
        const name = projectFileLabel(info.lastProjectPath) ?? 'project';
        if (window.confirm(`Reopen last project "${name}"?`)) {
          await openSavedProject(info.lastProjectPath);
        }
      }
    })();
  }, []);
}
