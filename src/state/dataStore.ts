import { create } from 'zustand';

import type { ColumnInference, ColumnType, RowBatch } from '@workers/types';
import { materializeRowBatch } from '@workers/utils/materializeRowBatch';

export interface GridColumn {
  key: string;
  headerName: string;
  type: ColumnType;
  confidence: number;
  examples: string[];
}

export interface GridRow {
  __rowId: number;
  [column: string]: unknown;
}

export type LoaderStatus = 'idle' | 'loading' | 'ready' | 'error';

interface DataState {
  fileName: string | null;
  columns: GridColumn[];
  rows: GridRow[];
  filteredRows: GridRow[] | null;
  searchRows: GridRow[] | null;
  status: LoaderStatus;
  message: string | null;
  stats: RowBatch['stats'] | null;
  totalRows: number;
  matchedRows: number | null;
  filterMatchedRows: number | null;
  searchMatchedRows: number | null;
  startLoading: (fileName: string) => void;
  setHeader: (header: string[]) => void;
  appendBatch: (batch: RowBatch) => void;
  complete: (summary: { rowsParsed: number; bytesParsed: number; durationMs: number }) => void;
  setError: (message: string) => void;
  setFilterResult: (payload: { rows: GridRow[]; totalRows: number; matchedRows: number | null }) => void;
  setSearchResult: (payload: { rows: GridRow[]; totalRows: number; matchedRows: number }) => void;
  clearSearchResult: () => void;
  clearFilterResult: () => void;
  reset: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const confidenceLabel = (inference: ColumnInference): number => {
  return Math.round(Math.min(1, Math.max(0, inference.confidence)) * 100);
};

export const useDataStore = create<DataState>((set) => ({
  fileName: null,
  columns: [],
  rows: [],
  filteredRows: null,
  searchRows: null,
  status: 'idle',
  message: null,
  stats: null,
  totalRows: 0,
  matchedRows: null,
  filterMatchedRows: null,
  searchMatchedRows: null,
  startLoading: (fileName) =>
    set(() => ({
      fileName,
      columns: [],
      rows: [],
      filteredRows: null,
      searchRows: null,
      status: 'loading',
      message: null,
      stats: null,
      totalRows: 0,
      matchedRows: null,
      filterMatchedRows: null,
      searchMatchedRows: null
    })),
  setHeader: (header) =>
    set((state) => ({
      columns: header.map((key) => {
        const baseName = key || 'column';
        return {
          key,
          headerName: baseName,
          type: 'string' as ColumnType,
          confidence: 0,
          examples: []
        };
      }),
      rows: state.rows
    })),
  appendBatch: (batch) => {
    const materialized = materializeRowBatch(batch);

    set((state) => {
      const stats = batch.stats;

      const columns =
        state.columns.length > 0
          ? state.columns.map((column) => {
              const meta = materialized.columnMeta[column.key];
              if (!meta) {
                return column;
              }

              return {
                ...column,
                type: meta.type,
                confidence: confidenceLabel(meta.inference),
                examples: meta.inference.examples
              };
            })
          : Object.keys(materialized.columnMeta).map((key) => {
              const meta = materialized.columnMeta[key]!;
              return {
                key,
                headerName: key,
                type: meta.type,
                confidence: confidenceLabel(meta.inference),
                examples: meta.inference.examples
              };
            });

      return {
        columns,
        rows: state.rows.concat(materialized.rows as GridRow[]),
        filteredRows: state.filteredRows,
        searchRows: state.searchRows,
        status: 'loading' as LoaderStatus,
        message: state.message,
        stats,
        totalRows: state.rows.length + materialized.rows.length,
        matchedRows: state.matchedRows,
        filterMatchedRows: state.filterMatchedRows,
        searchMatchedRows: state.searchMatchedRows
      };
    });
  },
  complete: (summary) => {
    set((state) => ({
      status: 'ready',
      message: `Loaded ${summary.rowsParsed.toLocaleString()} rows in ${(summary.durationMs / 1000).toFixed(1)}s`,
      stats: state.stats,
      totalRows: summary.rowsParsed,
      matchedRows: state.matchedRows,
      filterMatchedRows: state.filterMatchedRows,
      searchMatchedRows: state.searchMatchedRows
    }));
  },
  setError: (message) =>
    set(() => ({
      status: 'error',
      message
    })),
  setFilterResult: ({ rows, totalRows, matchedRows }) =>
    set((state) => ({
      filteredRows: rows,
      searchRows: null,
      matchedRows,
      totalRows,
      status: 'ready',
      filterMatchedRows: matchedRows,
      searchMatchedRows: null,
      message:
        matchedRows != null
          ? `Showing ${matchedRows.toLocaleString()} of ${totalRows.toLocaleString()} rows`
          : state.message
    })),
  setSearchResult: ({ rows, totalRows, matchedRows }) =>
    set((state) => ({
      searchRows: rows,
      matchedRows,
      totalRows,
      status: 'ready',
      searchMatchedRows: matchedRows,
      filteredRows: state.filteredRows,
      filterMatchedRows: state.filterMatchedRows,
      message: `Found ${matchedRows.toLocaleString()} matches across ${totalRows.toLocaleString()} rows`
    })),
  clearSearchResult: () =>
    set((state) => ({
      searchRows: null,
      matchedRows: state.filterMatchedRows,
      searchMatchedRows: null,
      message:
        state.filterMatchedRows != null
          ? `Showing ${state.filterMatchedRows.toLocaleString()} of ${state.totalRows.toLocaleString()} rows`
          : null
    })),
  clearFilterResult: () =>
    set((state) => ({
      filteredRows: null,
      filterMatchedRows: null,
      matchedRows: state.searchMatchedRows,
      message:
        state.searchMatchedRows != null
          ? `Found ${state.searchMatchedRows.toLocaleString()} matches across ${state.totalRows.toLocaleString()} rows`
          : null
    })),
  reset: () =>
    set(() => ({
      fileName: null,
      columns: [],
      rows: [],
      filteredRows: null,
      searchRows: null,
      status: 'idle',
      message: null,
      stats: null,
      totalRows: 0,
      matchedRows: null,
      filterMatchedRows: null,
      searchMatchedRows: null
    }))
}));
