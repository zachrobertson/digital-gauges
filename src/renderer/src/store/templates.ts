import { create } from 'zustand';
import type { GaugeTemplateSummary } from '@shared/types';

interface TemplateStore {
  templates: GaugeTemplateSummary[];
  refresh: () => Promise<void>;
}

export const useTemplateStore = create<TemplateStore>((set) => ({
  templates: [],
  refresh: async () => {
    try {
      const templates = await window.api.listGaugeTemplates();
      set({ templates });
    } catch {
      set({ templates: [] });
    }
  },
}));
