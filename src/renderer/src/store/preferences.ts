import { create } from 'zustand';
import type { AppSettings } from '@shared/types';
import { DEFAULT_APP_SETTINGS } from '@shared/types';

interface PreferencesState {
  settings: AppSettings;
  loaded: boolean;
  /** Load persisted settings from the main process. Called once on app mount. */
  loadSettings(): Promise<void>;
  /**
   * Persist a settings patch and update the store.
   * Returns whether `previewResolution` actually changed (so callers can rebuild).
   */
  updateSettings(patch: Partial<AppSettings>): Promise<{ previewResolutionChanged: boolean }>;
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  settings: { ...DEFAULT_APP_SETTINGS },
  loaded: false,

  loadSettings: async () => {
    const settings = await window.api.getAppSettings();
    set({ settings, loaded: true });
  },

  updateSettings: async (patch) => {
    const prev = get().settings;
    const next = await window.api.updateAppSettings(patch);
    set({ settings: next, loaded: true });
    return { previewResolutionChanged: next.previewResolution !== prev.previewResolution };
  },
}));
