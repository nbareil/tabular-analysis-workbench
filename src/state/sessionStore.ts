import { createWithEqualityFn } from 'zustand/traditional';

import type { ColumnInference, GroupAggregationDefinition, SortDefinition } from '@workers/types';

export interface ColumnLayoutState {
  order: string[];
  visibility: Record<string, boolean>;
}

export interface FilterState {
  id: string;
  column: string;
  operator: string;
  value: unknown;
  value2?: unknown;
  rawValue?: string;
  rawValue2?: string;
  caseSensitive?: boolean;
  enabled?: boolean;
}

/** View state for the open file. It lives in memory only and resets when another file is opened. */
export interface SessionSnapshot {
  /** Files in the open dataset; several files are merged into one timeline. */
  fileHandles: FileSystemFileHandle[];
  filters: FilterState[];
  sorts: SortDefinition[];
  groups: string[];
  groupAggregations: GroupAggregationDefinition[];
  columnLayout: ColumnLayoutState;
}

interface SessionStore extends SessionSnapshot {
  openFiles: (handles: FileSystemFileHandle[]) => void;
  setFilters: (filters: FilterState[]) => void;
  setSorts: (sorts: SortDefinition[]) => void;
  setGroups: (groups: string[]) => void;
  setGroupAggregations: (aggregations: GroupAggregationDefinition[]) => void;
  setColumnLayout: (layout: ColumnLayoutState) => void;
  initializeColumnLayout: (columns: string[], columnInference: Record<string, ColumnInference>, totalRows: number) => void;
}

const initialState: SessionSnapshot = {
  fileHandles: [],
  filters: [],
  sorts: [],
  groups: [],
  groupAggregations: [{ operator: 'count', alias: 'count' }],
  columnLayout: { order: [], visibility: {} }
};

export const useSessionStore = createWithEqualityFn<SessionStore>()((set) => ({
  ...initialState,
  openFiles: (fileHandles) => set({ ...initialState, fileHandles }),
  setFilters: (filters) => set({ filters }),
  setSorts: (sorts) => set({ sorts }),
  setGroups: (groups) => set({ groups }),
  setGroupAggregations: (groupAggregations) => set({ groupAggregations }),
  setColumnLayout: (columnLayout) => set({ columnLayout }),
  initializeColumnLayout: (columns, columnInference, totalRows) =>
    set(() => {
      const visibility: Record<string, boolean> = {};
      for (const columnKey of columns) {
        const inference = columnInference[columnKey];
        // Hide columns that are entirely empty
        visibility[columnKey] = inference ? inference.nullCount < totalRows : true;
      }
      return { columnLayout: { order: columns, visibility } };
    })
}));

export const getSessionSnapshot = (): Omit<SessionSnapshot, 'fileHandles'> & { fileNames: string[] } => {
  const { fileHandles, filters, sorts, groups, groupAggregations, columnLayout } = useSessionStore.getState();
  return { fileNames: fileHandles.map((handle) => handle.name), filters, sorts, groups, groupAggregations, columnLayout };
};

/** Display name for a dataset: the file name, or "first.csv + N more" for merged files. */
export const describeFiles = (handles: FileSystemFileHandle[]): string =>
  handles.length <= 1 ? (handles[0]?.name ?? '') : `${handles[0]!.name} + ${handles.length - 1} more`;
