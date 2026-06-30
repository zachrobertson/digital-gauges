import { useEffect, useRef } from 'react';
import { useProject } from '../store/project';
import { projectHasSessionContent } from './projectSession';

const AUTOSAVE_MS = 1500;

/**
 * Debounced draft autosave — persists edit state to userData so offsets,
 * gauges, and tracks survive an unexpected quit.
 */
export function useProjectAutosave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flush = () => {
      const { project, projectFilePath } = useProject.getState();
      if (!projectHasSessionContent(project)) return;
      void window.api.saveDraft(project, projectFilePath);
    };

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, AUTOSAVE_MS);
    };

    const unsub = useProject.subscribe((state, prev) => {
      if (state.project === prev.project) return;
      schedule();
    });

    const onBeforeUnload = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      unsub();
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
