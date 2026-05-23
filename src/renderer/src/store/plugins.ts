import { create } from 'zustand';
import type { GaugePlugin, UserPluginInfo } from '@shared/types';
import { BUILTIN_GAUGES } from '../gauges';

interface PluginsState {
  builtins: GaugePlugin[];
  user: Array<{ info: UserPluginInfo; plugin: GaugePlugin | null }>;

  setUserPlugins(plugins: UserPluginInfo[]): Promise<void>;
}

export const usePlugins = create<PluginsState>((set, get) => ({
  builtins: BUILTIN_GAUGES,
  user: [],

  setUserPlugins: async (infos) => {
    const next = await Promise.all(
      infos.map(async (info) => {
        if (info.error || !info.moduleUrl) {
          return { info, plugin: null };
        }
        try {
          const mod = await import(/* @vite-ignore */ info.moduleUrl);
          const plugin: GaugePlugin = mod.default ?? mod.plugin;
          if (!plugin || !plugin.id || !plugin.renderToCanvas) {
            return { info: { ...info, error: 'Module did not export a valid GaugePlugin default.' }, plugin: null };
          }
          return { info, plugin };
        } catch (e) {
          return { info: { ...info, error: (e as Error).message }, plugin: null };
        }
      }),
    );
    set({ user: next });
  },
}));

/** All gauges (built-in + user) flat list, by id. */
export function allPlugins(state = usePlugins.getState()): GaugePlugin[] {
  return [
    ...state.builtins,
    ...state.user.map((u) => u.plugin).filter((p): p is GaugePlugin => !!p),
  ];
}

export function findPluginById(id: string): GaugePlugin | undefined {
  return allPlugins().find((p) => p.id === id);
}
