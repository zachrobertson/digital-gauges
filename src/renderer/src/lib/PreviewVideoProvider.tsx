import { createContext, useContext, type ReactNode } from 'react';
import { useProject } from '../store/project';
import { usePreviewVideo } from './usePreviewVideo';

export interface PreviewVideoState {
  previewPath: string | null;
  loading: boolean;
  error: string | null;
}

const PreviewVideoContext = createContext<PreviewVideoState>({
  previewPath: null,
  loading: false,
  error: null,
});

/** Keeps concat preview alive across workspace switches (Edit / Sync / Gauges / Export). */
export function PreviewVideoProvider({ children }: { children: ReactNode }) {
  const clips = useProject((s) => s.project.clips);
  const value = usePreviewVideo(clips);
  return (
    <PreviewVideoContext.Provider value={value}>
      {children}
    </PreviewVideoContext.Provider>
  );
}

export function usePreviewVideoState(): PreviewVideoState {
  return useContext(PreviewVideoContext);
}
