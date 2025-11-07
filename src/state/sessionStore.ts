import { create } from 'zustand';

import { DATA_DEFAULT_FONT_ID, DEFAULT_FONT_ID, DEFAULT_FONT_SIZE } from '@constants/fonts';
import type { ColumnInference, GroupAggregationDefinition } from '@workers/types';

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
  fuzzy?: boolean;
  caseSensitive?: boolean;
}

export interface SessionSnapshot {
  fileHandle: FileSystemFileHandle | null;
  filters: FilterState[];
  sorts: { column: string; direction: 'asc' | 'desc' }[];
  groups: string[];
  groupAggregations: GroupAggregationDefinition[];
  columnLayout: ColumnLayoutState;
  searchCaseSensitive: boolean;
  interfaceFontFamily: string;
  interfaceFontSize: number;
  dataFontFamily: string;
  dataFontSize: number;
  updatedAt: number;
}

interface SessionStore extends SessionSnapshot {
  setFileHandle: (handle: FileSystemFileHandle | null) => void;
  setFilters: (filters: FilterState[]) => void;
  setSorts: (sorts: SessionSnapshot['sorts']) => void;
  setGroups: (groups: string[]) => void;
  setGroupAggregations: (aggregations: GroupAggregationDefinition[]) => void;
  setColumnLayout: (layout: ColumnLayoutState) => void;
  initializeColumnLayout: (columns: string[], columnInference: Record<string, ColumnInference>, totalRows: number) => void;
  setSearchCaseSensitive: (value: boolean) => void;
  setInterfaceFontFamily: (value: string) => void;
  setInterfaceFontSize: (value: number) => void;
  setDataFontFamily: (value: string) => void;
  setDataFontSize: (value: number) => void;
  touch: () => void;
  clear: () => void;
}

const defaultColumnLayout: ColumnLayoutState = {
  order: [],
  visibility: {}
};

const initialState: SessionSnapshot = {
  fileHandle: null,
  filters: [],
  sorts: [],
  groups: [],
  groupAggregations: [
    {
      operator: 'count',
      alias: 'count'
    }
  ],
  columnLayout: defaultColumnLayout,
  searchCaseSensitive: false,
  interfaceFontFamily: DEFAULT_FONT_ID,
  interfaceFontSize: DEFAULT_FONT_SIZE,
  dataFontFamily: DATA_DEFAULT_FONT_ID,
  dataFontSize: DEFAULT_FONT_SIZE,
  updatedAt: Date.now()
};

export const useSessionStore = create<SessionStore>((set) => ({
  ...initialState,
  setFileHandle: (fileHandle) => set(() => ({ fileHandle, updatedAt: Date.now() })),
  setFilters: (filters) => set(() => ({ filters, updatedAt: Date.now() })),
  setSorts: (sorts) => set(() => ({ sorts, updatedAt: Date.now() })),
  setGroups: (groups) => set(() => ({ groups, updatedAt: Date.now() })),
  setGroupAggregations: (groupAggregations) =>
    set(() => ({ groupAggregations, updatedAt: Date.now() })),
  setColumnLayout: (columnLayout) => set(() => ({ columnLayout, updatedAt: Date.now() })),
  initializeColumnLayout: (columns, columnInference, totalRows) => set((state) => {
    const visibility: Record<string, boolean> = {};
    for (const columnKey of columns) {
      const inference = columnInference[columnKey];
      // Hide columns that are entirely null
      visibility[columnKey] = inference ? inference.nullCount < totalRows : true;
    }
    return {
      columnLayout: {
        order: columns,
        visibility
      },
      updatedAt: Date.now()
    };
  }),
  setSearchCaseSensitive: (searchCaseSensitive) =>
    set(() => ({ searchCaseSensitive, updatedAt: Date.now() })),
  setInterfaceFontFamily: (interfaceFontFamily) =>
    set(() => ({ interfaceFontFamily, updatedAt: Date.now() })),
  setInterfaceFontSize: (interfaceFontSize) =>
    set(() => ({ interfaceFontSize, updatedAt: Date.now() })),
  setDataFontFamily: (dataFontFamily) =>
    set(() => ({ dataFontFamily, updatedAt: Date.now() })),
  setDataFontSize: (dataFontSize) => set(() => ({ dataFontSize, updatedAt: Date.now() })),
  touch: () => set(() => ({ updatedAt: Date.now() })),
  clear: () => set(() => ({ ...initialState, updatedAt: Date.now() }))
}));
