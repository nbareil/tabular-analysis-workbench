import { createWithEqualityFn } from 'zustand/traditional';

import type { ColumnInference, ColumnType, GroupingResult, ParseStats } from '@workers/types';
import type { DidYouMeanInfo } from '@workers/didYouMean';
import type { ColumnValueDistributionResult, LoadCompleteSummary } from '@workers/workerApiTypes';
import { getDataWorker } from '@workers/dataWorkerProxy';
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

export interface ColumnValueDistributionCacheEntry {
  status: 'loading' | 'ready' | 'error';
  result?: ColumnValueDistributionResult;
  error?: string;
}

/** A request for the grid to move its focus; `seq` makes repeated identical requests distinct. */
export type GridNavigation =
  | { kind: 'row'; rowId: number; seq: number }
  | { kind: 'next' | 'previous' | 'nextLabelled' | 'previousLabelled'; seq: number };

export interface DataState {
  /** Increments for every load so late async results for a previous file can be discarded. */
  loadId: number;
  fileName: string | null;
  columns: GridColumn[];
  columnInference: Record<string, ColumnInference>;
  status: LoaderStatus;
  message: string | null;
  errorDetails: {
    message: string;
    stack?: string;
    payload?: unknown;
    timestamp: number;
  } | null;
  stats: ParseStats | null;
  totalRows: number;
  /** Rows in the current view (after filter and search). */
  matchedRows: number | null;
  filterActive: boolean;
  searchActive: boolean;
  filterPredicateMatchCounts: Record<string, number> | null;
  columnValueDistributions: Record<string, ColumnValueDistributionCacheEntry>;
  didYouMean: DidYouMeanInfo | null;
  /** Increments whenever the worker's row order changes, so grids refetch. */
  viewVersion: number;
  navigation: GridNavigation | null;
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
  complete: (summary: LoadCompleteSummary) => void;
  /** Records an error for the diagnostics toast without changing the load status. */
  setError: (message: string, details?: unknown) => void;
  failLoading: (message: string) => void;
  clearError: () => void;
  setFilterSummary: (payload: {
    matchedRows: number;
    totalRows: number;
    didYouMean?: DidYouMeanInfo;
    filterMatchCounts?: Record<string, number>;
  }) => void;
  clearFilterSummary: (matchedRows: number) => void;
  setMatchedRowCount: (value: number) => void;
  setSearchResult: (payload: { totalRows: number; matchedRows: number }) => void;
  clearSearchResult: (matchedRows?: number) => void;
  /** Fetches a column's value counts once per load; concurrent callers share the request. */
  loadColumnValueDistribution: (column: string) => Promise<void>;
  bumpViewVersion: () => void;
  navigateGrid: (request: { kind: 'row'; rowId: number } | { kind: Exclude<GridNavigation['kind'], 'row'> }) => void;
  setGroupingLoading: () => void;
  setGroupingResult: (result: GroupingResult) => void;
  setGroupingError: (message: string) => void;
  clearGrouping: () => void;
  reset: () => void;
}

const confidencePercent = (inference: ColumnInference): number =>
  Math.round(Math.min(1, Math.max(0, inference.confidence)) * 100);

const toGridColumn = (key: string, inference?: ColumnInference): GridColumn =>
  inference
    ? { key, headerName: key, type: inference.type, confidence: confidencePercent(inference), examples: inference.examples }
    : { key, headerName: key, type: 'string', confidence: 0, examples: [] };

const buildErrorDetails = (message: string, details?: unknown): DataState['errorDetails'] => {
  if (details instanceof Error) {
    return {
      message,
      stack: details.stack,
      payload: { name: details.name, originalMessage: details.message },
      timestamp: Date.now()
    };
  }
  return details ? { message, payload: details, timestamp: Date.now() } : { message, timestamp: Date.now() };
};

const initialGroupingState = (): DataState['grouping'] => ({
  status: 'idle',
  rows: [],
  groupBy: [],
  totalGroups: 0,
  totalRows: 0,
  error: null
});

const emptyFileState = {
  fileName: null,
  columns: [],
  columnInference: {},
  status: 'idle' as LoaderStatus,
  message: null,
  errorDetails: null,
  stats: null,
  totalRows: 0,
  matchedRows: null,
  filterActive: false,
  searchActive: false,
  filterPredicateMatchCounts: null,
  columnValueDistributions: {},
  didYouMean: null
};

export const useDataStore = createWithEqualityFn<DataState>()((set, get) => ({
  ...emptyFileState,
  loadId: 0,
  viewVersion: 0,
  navigation: null,
  grouping: initialGroupingState(),
  startLoading: (fileName) =>
    set((state) => ({
      ...emptyFileState,
      fileName,
      status: 'loading',
      loadId: state.loadId + 1,
      viewVersion: state.viewVersion + 1,
      grouping: initialGroupingState()
    })),
  setHeader: (header) => set({ columns: header.map((key) => toGridColumn(key)) }),
  reportProgress: (progress) =>
    set((state) => ({
      stats: { rowsParsed: progress.rowsParsed, bytesParsed: progress.bytesParsed, malformedRows: 0, eof: false },
      totalRows: progress.rowsParsed,
      matchedRows: state.filterActive || state.searchActive ? state.matchedRows : progress.rowsParsed,
      message: `Streaming… parsed ${progress.rowsParsed.toLocaleString()} rows (${formatBytes(progress.bytesParsed)})`
    })),
  complete: (summary) =>
    set((state) => ({
      status: 'ready',
      message:
        `Loaded ${summary.rowsParsed.toLocaleString()} rows in ${(summary.durationMs / 1000).toFixed(1)}s` +
        (summary.malformedRows > 0 ? ` (${summary.malformedRows.toLocaleString()} malformed rows)` : ''),
      stats: {
        rowsParsed: summary.rowsParsed,
        bytesParsed: summary.bytesParsed,
        malformedRows: summary.malformedRows,
        eof: true
      },
      totalRows: summary.rowsParsed,
      matchedRows: state.filterActive || state.searchActive ? state.matchedRows : summary.rowsParsed,
      columns: summary.columns.map((key) => toGridColumn(key, summary.columnInference[key])),
      columnInference: summary.columnInference,
      columnValueDistributions: {}
    })),
  setError: (message, details) => set({ errorDetails: buildErrorDetails(message, details) }),
  failLoading: (message) => set({ status: 'error', message }),
  clearError: () => set({ errorDetails: null }),
  setFilterSummary: ({ matchedRows, didYouMean, filterMatchCounts }) =>
    set({
      matchedRows,
      filterActive: true,
      didYouMean: didYouMean ?? null,
      filterPredicateMatchCounts: filterMatchCounts ?? null
    }),
  clearFilterSummary: (matchedRows) =>
    set({ matchedRows, filterActive: false, didYouMean: null, filterPredicateMatchCounts: null }),
  setMatchedRowCount: (matchedRows) => set({ matchedRows }),
  setSearchResult: ({ matchedRows }) => set({ matchedRows, searchActive: true }),
  clearSearchResult: (matchedRows) =>
    set((state) => ({ searchActive: false, matchedRows: matchedRows ?? state.matchedRows })),
  async loadColumnValueDistribution(column) {
    const { loadId, columnValueDistributions } = get();
    const existing = columnValueDistributions[column];
    if (existing && existing.status !== 'error') {
      return;
    }
    const update = (entry: ColumnValueDistributionCacheEntry): void => {
      if (get().loadId === loadId) {
        set((state) => ({ columnValueDistributions: { ...state.columnValueDistributions, [column]: entry } }));
      }
    };
    update({ status: 'loading' });
    try {
      update({ status: 'ready', result: await getDataWorker().getColumnValueDistribution({ column }) });
    } catch (error) {
      update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  },
  bumpViewVersion: () => set((state) => ({ viewVersion: state.viewVersion + 1 })),
  navigateGrid: (request) =>
    set((state) => ({ navigation: { ...request, seq: (state.navigation?.seq ?? 0) + 1 } as GridNavigation })),
  setGroupingLoading: () => set((state) => ({ grouping: { ...state.grouping, status: 'loading', error: null } })),
  setGroupingResult: (result) =>
    set({
      grouping: {
        status: 'ready',
        rows: result.rows,
        groupBy: result.groupBy,
        totalGroups: result.totalGroups,
        totalRows: result.totalRows,
        error: null
      }
    }),
  setGroupingError: (message) => set({ grouping: { ...initialGroupingState(), status: 'error', error: message } }),
  clearGrouping: () => set({ grouping: initialGroupingState() }),
  reset: () =>
    set((state) => ({
      ...emptyFileState,
      loadId: state.loadId + 1,
      viewVersion: state.viewVersion + 1,
      grouping: initialGroupingState()
    }))
}));
