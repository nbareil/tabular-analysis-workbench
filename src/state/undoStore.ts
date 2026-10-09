import { createWithEqualityFn } from 'zustand/traditional';

import type { FilterState } from './sessionStore';
import type { TagRecord } from '@workers/types';

/** A reversible edit: each side holds the full state needed to re-apply it. */
export type UndoEntry =
  | { kind: 'filters'; before: FilterState[]; after: FilterState[] }
  | { kind: 'tags'; before: Record<number, TagRecord | null>; after: Record<number, TagRecord | null> };

const MAX_ENTRIES = 100;
/** Edits with the same merge key within this window become one undo step (e.g. typing a value). */
const MERGE_WINDOW_MS = 1_500;

interface UndoState {
  past: UndoEntry[];
  future: UndoEntry[];
  /** Merge key and time of the newest `past` entry. */
  lastRecorded: { mergeKey?: string; at: number } | null;
  record: (entry: UndoEntry, mergeKey?: string) => void;
  /** Pops the latest edit; the caller applies its `before` side. */
  takeUndo: () => UndoEntry | null;
  /** Pops the latest undone edit; the caller applies its `after` side. */
  takeRedo: () => UndoEntry | null;
  clear: () => void;
}

export const useUndoStore = createWithEqualityFn<UndoState>()((set, get) => ({
  past: [],
  future: [],
  lastRecorded: null,
  record: (entry, mergeKey) =>
    set((state) => {
      const now = Date.now();
      const last = state.past.at(-1);
      const recent = state.lastRecorded;
      const lastRecorded = { mergeKey, at: now };
      if (mergeKey && last?.kind === entry.kind && recent?.mergeKey === mergeKey && now - recent.at < MERGE_WINDOW_MS) {
        const merged = { ...last, after: entry.after } as UndoEntry;
        return { past: [...state.past.slice(0, -1), merged], future: [], lastRecorded };
      }
      return { past: [...state.past, entry].slice(-MAX_ENTRIES), future: [], lastRecorded };
    }),
  takeUndo: () => {
    const entry = get().past.at(-1) ?? null;
    if (entry) {
      set((state) => ({ past: state.past.slice(0, -1), future: [...state.future, entry], lastRecorded: null }));
    }
    return entry;
  },
  takeRedo: () => {
    const entry = get().future.at(-1) ?? null;
    if (entry) {
      set((state) => ({ future: state.future.slice(0, -1), past: [...state.past, entry], lastRecorded: null }));
    }
    return entry;
  },
  clear: () => set({ past: [], future: [], lastRecorded: null })
}));
