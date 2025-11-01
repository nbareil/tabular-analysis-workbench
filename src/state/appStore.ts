import { create } from 'zustand';

type ThemeMode = 'dark' | 'light';

interface AppState {
  theme: ThemeMode;
  fuzzyEnabled: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setFuzzyEnabled: (enabled: boolean) => void;
}

const THEME_STORAGE_KEY = 'wlx:theme';

const readInitialTheme = (): ThemeMode => {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;

  if (stored === 'dark' || stored === 'light') {
    return stored;
  }

  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
};

export const useAppStore = create<AppState>((set) => ({
  theme: readInitialTheme(),
  fuzzyEnabled: true,
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }

    set({ theme });
  },
  toggleTheme: () => {
    set((state) => {
      const nextTheme: ThemeMode = state.theme === 'dark' ? 'light' : 'dark';

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }

      return { theme: nextTheme };
    });
  },
  setFuzzyEnabled: (enabled) => set({ fuzzyEnabled: enabled })
}));
