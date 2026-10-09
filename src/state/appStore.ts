import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';

import { DATA_DEFAULT_FONT_ID, DEFAULT_FONT_ID, DEFAULT_FONT_SIZE } from '@constants/fonts';

type ThemeMode = 'dark' | 'light';

/**
 * How datetime cells are displayed: `original` shows the file's text untouched; any other value
 * is an IANA time zone (or `UTC`) that datetime cells are converted to.
 */
export type DisplayTimeZone = 'original' | string;

/** User preferences, persisted to localStorage and shared by every file. */
interface AppState {
  theme: ThemeMode;
  interfaceFontFamily: string;
  interfaceFontSize: number;
  dataFontFamily: string;
  dataFontSize: number;
  searchCaseSensitive: boolean;
  displayTimeZone: DisplayTimeZone;
  toggleTheme: () => void;
  setInterfaceFontFamily: (value: string) => void;
  setInterfaceFontSize: (value: number) => void;
  setDataFontFamily: (value: string) => void;
  setDataFontSize: (value: number) => void;
  setSearchCaseSensitive: (value: boolean) => void;
  setDisplayTimeZone: (value: DisplayTimeZone) => void;
}

export const PREFERENCES_STORAGE_KEY = 'wlx:preferences';

const prefersDark = (): boolean =>
  typeof window === 'undefined' || window.matchMedia?.('(prefers-color-scheme: dark)').matches !== false;

export const useAppStore = createWithEqualityFn<AppState>()(
  persist(
    (set) => ({
      theme: prefersDark() ? 'dark' : 'light',
      interfaceFontFamily: DEFAULT_FONT_ID,
      interfaceFontSize: DEFAULT_FONT_SIZE,
      dataFontFamily: DATA_DEFAULT_FONT_ID,
      dataFontSize: DEFAULT_FONT_SIZE,
      searchCaseSensitive: false,
      displayTimeZone: 'original',
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      setInterfaceFontFamily: (interfaceFontFamily) => set({ interfaceFontFamily }),
      setInterfaceFontSize: (interfaceFontSize) => set({ interfaceFontSize }),
      setDataFontFamily: (dataFontFamily) => set({ dataFontFamily }),
      setDataFontSize: (dataFontSize) => set({ dataFontSize }),
      setSearchCaseSensitive: (searchCaseSensitive) => set({ searchCaseSensitive }),
      setDisplayTimeZone: (displayTimeZone) => set({ displayTimeZone })
    }),
    { name: PREFERENCES_STORAGE_KEY }
  )
);
