import { expose } from 'comlink';

import { parseDelimitedStream, type ParserOptions } from './csvParser';
import { materializeRowBatch, type MaterializedRow } from './utils/materializeRowBatch';
import {
  RowIndexStore,
  type RowIndexData,
  findNearestCheckpoint
} from './rowIndexStore';
import { sortMaterializedRows } from './sortEngine';
import { groupMaterializedRows } from './groupEngine';
import type {
  ColumnType,
  Delimiter,
  FilterNode,
  GroupingRequest,
  GroupingResult,
  RowBatch,
  SortDefinition
} from './types';
import { evaluateFilterOnRows } from './filterEngine';
import { searchRows, type SearchRequest, type SearchResult } from './searchEngine';

export interface WorkerInitOptions {
  enableDuckDb?: boolean;
  chunkSize?: number;
}

export interface LoadFileRequest {
  handle: FileSystemFileHandle;
  delimiter?: Delimiter;
  batchSize?: number;
  encoding?: string;
  checkpointInterval?: number;
}

export interface LoadFileCallbacks {
  onStart?: (payload: { columns: string[] }) => void | Promise<void>;
  onBatch: (batch: RowBatch) => void | Promise<void>;
  onComplete?: (summary: { rowsParsed: number; bytesParsed: number; durationMs: number }) => void | Promise<void>;
  onError?: (error: { message: string; name?: string; stack?: string }) => void | Promise<void>;
}

export interface SeekRowsRequest {
  handle: FileSystemFileHandle;
  startRow: number;
  rowCount: number;
}

export interface SeekRowsResult {
  entries: Array<{ rowIndex: number; byteOffset: number }>;
  checkpointInterval: number;
}

export interface ApplySortRequest {
  sorts: SortDefinition[];
  offset?: number;
  limit?: number;
}

export interface ApplySortResult {
  rows: MaterializedRow[];
  totalRows: number;
  matchedRows: number;
  sorts: SortDefinition[];
}

export interface ApplyFilterRequest {
  expression: FilterNode | null;
  offset?: number;
  limit?: number;
}

export interface ApplyFilterResult {
  rows: MaterializedRow[];
  totalRows: number;
  matchedRows: number;
  expression: FilterNode | null;
}

export interface DataWorkerApi {
  init: (options: WorkerInitOptions) => Promise<void>;
  ping: () => Promise<string>;
  loadFile: (request: LoadFileRequest, callbacks: LoadFileCallbacks) => Promise<void>;
  loadRowIndex: (handle: FileSystemFileHandle) => Promise<RowIndexData | null>;
  seekRows: (request: SeekRowsRequest) => Promise<SeekRowsResult | null>;
  applySorts: (request: ApplySortRequest) => Promise<ApplySortResult>;
  applyFilter: (request: ApplyFilterRequest) => Promise<ApplyFilterResult>;
  groupBy: (request: GroupingRequest) => Promise<GroupingResult>;
  globalSearch: (request: SearchRequest) => Promise<SearchResult>;
}

const state: {
  options: Required<WorkerInitOptions>;
  dataset: {
    rows: MaterializedRow[];
    sortedRows: MaterializedRow[] | null;
    columnTypes: Record<string, ColumnType>;
    filteredRows: MaterializedRow[] | null;
    filterExpression: FilterNode | null;
    sorts: SortDefinition[];
  };
} = {
  options: {
    enableDuckDb: false,
    chunkSize: 1_048_576
  },
  dataset: {
    rows: [],
    sortedRows: null,
    columnTypes: {},
    filteredRows: null,
    filterExpression: null,
    sorts: []
  }
};

const api: DataWorkerApi = {
  async init(options) {
    state.options = {
      enableDuckDb: options.enableDuckDb ?? state.options.enableDuckDb,
      chunkSize: options.chunkSize ?? state.options.chunkSize
    };
  },
  async ping() {
    return 'pong';
  },
  async loadFile({ handle, delimiter, batchSize, encoding, checkpointInterval }, callbacks) {
    if (!handle) {
      throw new Error('A file handle must be provided to loadFile.');
    }

    state.dataset.rows = [];
    state.dataset.sortedRows = null;
    state.dataset.columnTypes = {};
    state.dataset.filteredRows = null;
    state.dataset.filterExpression = null;
    state.dataset.sorts = [];

    const file = await handle.getFile();
    const stream = file.stream();
    const reader = stream.getReader();
    const targetCheckpointInterval = checkpointInterval ?? 50_000;
    const options: ParserOptions = {
      delimiter,
      batchSize,
      encoding,
      checkpointInterval: targetCheckpointInterval
    };

    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let finalRows = 0;
    let finalBytes = 0;
    const indexStore = await RowIndexStore.create(handle, {
      checkpointInterval: targetCheckpointInterval
    });

    const source: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              return;
            }

            if (value) {
              yield value;
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    };

    try {
      await parseDelimitedStream(
        source,
        {
          onHeader: async (header) => {
            if (callbacks.onStart) {
              await callbacks.onStart({ columns: header });
            }
          },
          onBatch: async (batch) => {
            finalRows = batch.stats.rowsParsed;
            finalBytes = batch.stats.bytesParsed;
            const materialised = materializeRowBatch(batch);
            state.dataset.rows.push(...materialised.rows);
            state.dataset.columnTypes = {
              ...state.dataset.columnTypes,
              ...batch.columnTypes
            };
            if (state.dataset.sorts.length > 0 || state.dataset.filterExpression) {
              applyTransforms();
            }
            await callbacks.onBatch(batch);
          },
          onCheckpoint: async ({ rowIndex, byteOffset }) => {
            indexStore.record({ rowIndex, byteOffset });
          }
        },
        options
      );

      if (callbacks.onComplete) {
        const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        await callbacks.onComplete({
          rowsParsed: finalRows,
          bytesParsed: finalBytes,
          durationMs: endTime - startTime
        });
      }

      await indexStore.finalize({ rowCount: finalRows, bytesParsed: finalBytes });
    } catch (error) {
      await indexStore.abort();
      if (callbacks.onError) {
        const normalised =
          error instanceof Error
            ? { message: error.message, name: error.name, stack: error.stack }
            : { message: String(error) };
        await callbacks.onError(normalised);
      }

      throw error;
    }
  },
  async loadRowIndex(handle) {
    return RowIndexStore.load(handle);
  },
  async seekRows({ handle, startRow, rowCount }) {
    const index = await RowIndexStore.load(handle);
    if (!index || rowCount <= 0) {
      return null;
    }

    const entries: Array<{ rowIndex: number; byteOffset: number }> = [];
    const endRow = startRow + rowCount;
    const startEntry = findNearestCheckpoint(index.entries, startRow);

    if (startEntry) {
      entries.push(startEntry);
    }

    for (const entry of index.entries) {
      if (entry.rowIndex > startRow && entry.rowIndex < endRow) {
        entries.push(entry);
      }
    }

    return {
      entries,
      checkpointInterval: index.checkpointInterval
    };
  },
  async applySorts({ sorts, offset = 0, limit }): Promise<ApplySortResult> {
    if (!state.dataset.rows.length) {
      return { rows: [], totalRows: 0, matchedRows: 0, sorts: [] };
    }

    const validSorts = sorts.filter((sort) => state.dataset.columnTypes[sort.column] != null);
    state.dataset.sorts = validSorts;

    applyTransforms();

    const sortedRows = state.dataset.sortedRows ?? state.dataset.rows;
    const totalRows = state.dataset.rows.length;
    const matchedRows =
      state.dataset.filterExpression && state.dataset.filteredRows
        ? state.dataset.filteredRows.length
        : sortedRows.length;
    const start = Math.max(0, offset);
    const end = typeof limit === 'number' ? start + Math.max(0, limit) : sortedRows.length;
    const slice = sortedRows.slice(start, end);

    return {
      rows: slice,
      totalRows,
      matchedRows,
      sorts: validSorts
    };
  },
  async applyFilter({ expression, offset = 0, limit }: ApplyFilterRequest): Promise<ApplyFilterResult> {
    state.dataset.filterExpression = expression;

    if (!state.dataset.rows.length) {
      return {
        rows: [],
        totalRows: 0,
        matchedRows: 0,
        expression
      };
    }

    applyTransforms();

    const workingRows =
      state.dataset.filteredRows ?? state.dataset.sortedRows ?? state.dataset.rows;
    const totalRows = state.dataset.rows.length;
    const matchedRows = workingRows.length;
    const start = Math.max(0, offset);
    const end = typeof limit === 'number' ? start + Math.max(0, limit) : matchedRows;
    const slice = workingRows.slice(start, end);

    return {
      rows: slice,
      totalRows,
      matchedRows,
      expression
    };
  },
  async groupBy(request: GroupingRequest): Promise<GroupingResult> {
    if (!request.groupBy) {
      throw new Error('groupBy column must be provided.');
    }

    const workingRows =
      state.dataset.filteredRows ?? state.dataset.sortedRows ?? state.dataset.rows;

    if (!workingRows.length) {
      return {
        groupBy: request.groupBy,
        rows: [],
        totalGroups: 0,
        totalRows: 0
      };
    }

    return groupMaterializedRows(workingRows, state.dataset.columnTypes, request);
  },
  async globalSearch(request: SearchRequest): Promise<SearchResult> {
    if (!state.dataset.rows.length) {
      return {
        rows: [],
        totalRows: 0,
        matchedRows: 0
      };
    }

    const workingRows = state.dataset.sortedRows ?? state.dataset.rows;
    return searchRows(workingRows, state.dataset.columnTypes, request);
  }
};

const applyTransforms = (): void => {
  const { columnTypes, filterExpression, sorts } = state.dataset;

  const baseRows = state.dataset.rows;
  let sortedRows: MaterializedRow[] | null = null;

  if (sorts.length > 0) {
    sortedRows = sortMaterializedRows(baseRows, columnTypes, sorts).rows;
  }

  const workingRows = sortedRows ?? baseRows;
  state.dataset.sortedRows = sortedRows;

  if (filterExpression) {
    const { matches } = evaluateFilterOnRows(workingRows, columnTypes, filterExpression);
    const filtered = workingRows.filter((_, index) => matches[index] === 1);
    state.dataset.filteredRows = filtered;
  } else {
    state.dataset.filteredRows = null;
  }
};

expose(api);
