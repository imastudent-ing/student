import { create } from 'zustand';
import { DEFAULT_SETTINGS, type AppSettings } from '../domain/types';
import { loadSettings, saveSettings } from '../db/repositories';

interface SettingsStore {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

function applyDisplaySettings(settings: AppSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (settings.theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', settings.theme);
  }
  root.setAttribute('data-fontscale', settings.fontScale);
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await loadSettings();
    applyDisplaySettings(settings);
    set({ settings, loaded: true });
  },
  update: async (patch) => {
    const settings = { ...get().settings, ...patch };
    applyDisplaySettings(settings);
    set({ settings });
    await saveSettings(settings);
  }
}));
