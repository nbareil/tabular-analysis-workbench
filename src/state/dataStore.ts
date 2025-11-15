import { create } from 'zustand';

import type { ColumnInference, ColumnType, GroupingResult, RowBatch } from '@workers/types';
import type { FuzzyMatchInfo } from '@workers/filterEngine';
import { logDebug } from '@utils/debugLog';
import { formatBytes } from '@utils/formatBytes';

export interface GridColumn {
  key: string;
  headerName: string;
  type: ColumnType;
  confidence: number;
  examples: readonly string[];
}

export interface GridRow {
  __rowId: number;
  [column: string]: unknown;
}

export type LoaderStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DataState {
  fileName: string | null;
  columns: GridColumn[];
  columnInference: Record<string, ColumnInference>;
  searchRows: GridRow[] | null;
  status: LoaderStatus;
  message: string | null;
  errorDetails: {
    message: string;
    stack?: string;
    payload?: unknown;
    timestamp: number;
  } | null;
  stats: RowBatch['stats'] | null;
  totalRows: number;
  matchedRows: number | null;
  filterMatchedRows: number | null;
  filterPredicateMatchCounts: Record<string, number> | null;
  searchMatchedRows: number | null;
  fuzzyUsed: FuzzyMatchInfo | null;
  viewVersion: number;
  grouping: {
    status: LoaderStatus;
    rows: GroupingResult['rows'];
    groupBy: string[];
    totalGroups: number;
    totalRows: number;
    error: string | null;
  };
  startLoading: (fileName: string) => void;
  setHeader: (header: string[]) => void;
  reportProgress: (progress: { rowsParsed: number; bytesParsed: number }) => void;
  complete: (summary: {
    rowsParsed: number;
    bytesParsed: number;
    durationMs: number;
    columnTypes: Record<string, ColumnType>;
    columnInference: Record<string, ColumnInference>;
  }) => void;
  setError: (message: string, details?: unknown) => void;
  clearError: () => void;
  setFilterSummary: (payload: {
    matchedRows: number;
    totalRows: number;
    fuzzyUsed?: FuzzyMatchInfo;
    filterMatchCounts?: Record<string, number>;
  }) => void;
  clearFilterSummary: () => void;
  setMatchedRowCount: (value: number | null) => void;
  setFuzzyUsed: (fuzzyUsed: FuzzyMatchInfo | null) => void;
  bumpViewVersion: () => void;
  setSearchResult: (payload: { rows: GridRow[]; totalRows: number; matchedRows: number }) => void;
  clearSearchResult: () => void;
  setGroupingLoading: () => void;
  setGroupingResult: (result: GroupingResult) => void;
  setGroupingError: (message: string) => void;
  clearGrouping: () => void;
  reset: () => void;
}

const confidenceLabel = (inference: ColumnInference): number => {
  return Math.round(Math.min(1, Math.max(0, inference.confidence)) * 100);
};

const buildErrorDetails = (message: string, details?: unknown) => {
  if (!details) {
    return {
      message,
      timestamp: Date.now()
    };
  }

  if (details instanceof Error) {
    return {
      message,
      stack: details.stack,
      payload: {
        name: details.name,
        originalMessage: details.message
      },
      timestamp: Date.now()
    };
  }

  return {
    message,
    payload: details,
    timestamp: Date.now()
  };
};

const initialGroupingState = (): DataState['grouping'] => ({
  status: 'idle',
  rows: [],
  groupBy: [],
  totalGroups: 0,
  totalRows: 0,
  error: null
});

export const useDataStore = create<DataState>((set) => ({
  fileName: null,
  columns: [],
  columnInference: {},
  searchRows: null,
  status: 'idle',
  message: null,
  errorDetails: null,
  stats: null,
  totalRows: 0,
  matchedRows: null,
  filterMatchedRows: null,
  filterPredicateMatchCounts: null,
  searchMatchedRows: null,
  fuzzyUsed: null,
  viewVersion: 0,
  grouping: initialGroupingState(),
  startLoading: (fileName) =>
    set((state) => ({
      fileName,
      columns: [],
      columnInference: {},
      searchRows: null,
      status: 'loading',
      message: null,
      errorDetails: null,
      stats: null,
      totalRows: 0,
      matchedRows: null,
      filterMatchedRows: null,
      filterPredicateMatchCounts: null,
      searchMatchedRows: null,
      fuzzyUsed: null,
      viewVersion: state.viewVersion + 1,
      grouping: initialGroupingState()
    })),
  setHeader: (header) =>
    set((state) => {
      if (import.meta.env.DEV) {
        logDebug('data-store', 'setHeader', {
          headerCount: header.length,
          previousColumnCount: state.columns.length
        });
      }
      return {
        columns: header.map((key, index) => ({
          key,
          headerName: key || `column_${index + 1}`,
          type: 'string' as ColumnType,
          confidence: 0,
          examples: []
        }))
      };
    }),
  reportProgress: (progress) =>
    set((state) => {
      if (import.meta.env.DEV) {
        logDebug('data-store', 'reportProgress', {
          rowsParsed: progress.rowsParsed,
          bytesParsed: progress.bytesParsed,
          previousTotalRows: state.totalRows
        });
      }
      return {
        stats: {
          rowsParsed: progress.rowsParsed,
          bytesParsed: progress.bytesParsed,
          eof: false
        },
        totalRows: progress.rowsParsed,
        status: state.status === 'idle' ? 'loading' : state.status,
        message: `Streaming… parsed ${progress.rowsParsed.toLocaleString()} rows (${formatBytes(progress.bytesParsed)})`
      };
    }),
  complete: (summary) =>
    set((state) => {
      if (import.meta.env.DEV) {
        console.info('[data-store] complete', {
          rowsParsed: summary.rowsParsed,
          bytesParsed: summary.bytesParsed,
          previousStatus: state.status,
          currentColumnCount: state.columns.length
        });
      }
      const updatedColumns =
        state.columns.length > 0
          ? state.columns.map((column) => {
              const type = summary.columnTypes[column.key];
              const inference = summary.columnInference[column.key];

              if (!type || !inference) {
                return column;
              }

              return {
                ...column,
                type,
                confidence: confidenceLabel(inference),
                examples: inference.examples
              };
            })
          : Object.keys(summary.columnTypes).map((key) => {
              const type = summary.columnTypes[key]!;
              const inference = summary.columnInference[key]!;
              return {
                key,
                headerName: key,
                type,
                confidence: confidenceLabel(inference),
                examples: inference.examples
              };
            });

      const matchedRows =
        state.searchMatchedRows != null
          ? state.searchMatchedRows
          : state.filterMatchedRows != null
            ? state.filterMatchedRows
            : summary.rowsParsed;

      const nextState = {
        status: 'ready' as LoaderStatus,
        message: `Loaded ${summary.rowsParsed.toLocaleString()} rows in ${(summary.durationMs / 1000).toFixed(
          1
        )}s`,
        stats: {
          rowsParsed: summary.rowsParsed,
          bytesParsed: summary.bytesParsed,
          eof: true
        },
        totalRows: summary.rowsParsed,
        matchedRows,
        columns: updatedColumns,
        columnInference: summary.columnInference
      };

      if (import.meta.env.DEV) {
        logDebug('data-store', 'complete applied', {
          status: nextState.status,
          totalRows: nextState.totalRows,
          matchedRows: nextState.matchedRows,
          columnCount: nextState.columns.length
        });
      }

      return nextState;
    }),
  setError: (message, details) =>
    set((state) => {
      if (import.meta.env.DEV) {
        console.error('[data-store] setError', { message, previousStatus: state.status, details });
      }
      return {
        status: 'error',
        message,
        errorDetails: buildErrorDetails(message, details)
      };
    }),
  clearError: () =>
    set((state) => ({
      message: null,
      errorDetails: null,
      status: state.status === 'error' ? 'idle' : state.status
    })),
  setFilterSummary: ({ matchedRows, totalRows, fuzzyUsed, filterMatchCounts }) =>
    set(() => ({
      filterMatchedRows: matchedRows,
      matchedRows,
      totalRows,
      fuzzyUsed: fuzzyUsed ?? null,
      filterPredicateMatchCounts: filterMatchCounts ?? null
  })),
  clearFilterSummary: () =>
    set((state) => ({
      filterMatchedRows: null,
      fuzzyUsed: null,
      matchedRows: state.searchMatchedRows ?? state.totalRows,
      filterPredicateMatchCounts: null
  })),
  setMatchedRowCount: (value) =>
    set(() => ({
      matchedRows: value
    })),
  setFuzzyUsed: (fuzzyUsed) =>
    set(() => ({
      fuzzyUsed
    })),
  bumpViewVersion: () =>
    set((state) => ({
      viewVersion: state.viewVersion + 1
    })),
  setSearchResult: ({ rows, totalRows, matchedRows }) =>
    set((state) => ({
      searchRows: rows,
      matchedRows,
      totalRows,
      status: 'ready',
      searchMatchedRows: matchedRows,
      message: `Found ${matchedRows.toLocaleString()} matches across ${totalRows.toLocaleString()} rows`
    })),
  clearSearchResult: () =>
    set((state) => ({
      searchRows: null,
      matchedRows: state.filterMatchedRows ?? state.totalRows,
      searchMatchedRows: null,
      message:
        state.filterMatchedRows != null
          ? `Showing ${state.filterMatchedRows.toLocaleString()} of ${state.totalRows.toLocaleString()} rows`
          : null
    })),
  setGroupingLoading: () =>
    set((state) => ({
      grouping: {
        ...state.grouping,
        status: 'loading',
        error: null
      }
    })),
  setGroupingResult: (result) =>
    set(() => ({
      grouping: {
        status: 'ready',
        rows: result.rows,
        groupBy: result.groupBy,
        totalGroups: result.totalGroups,
        totalRows: result.totalRows,
        error: null
      }
    })),
  setGroupingError: (message) =>
    set(() => ({
      grouping: {
        status: 'error',
        rows: [],
        groupBy: [],
        totalGroups: 0,
        totalRows: 0,
        error: message
      }
    })),
  clearGrouping: () =>
    set(() => ({
      grouping: initialGroupingState()
    })),
  reset: () =>
    set((state) => ({
      fileName: null,
      columns: [],
      columnInference: {},
      searchRows: null,
      status: 'idle',
      message: null,
      errorDetails: null,
      stats: null,
      totalRows: 0,
      matchedRows: null,
      filterMatchedRows: null,
      searchMatchedRows: null,
      fuzzyUsed: null,
      filterPredicateMatchCounts: null,
      viewVersion: state.viewVersion + 1,
      grouping: initialGroupingState()
    }))
}));
