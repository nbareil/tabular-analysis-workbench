import { expose } from 'comlink';

import { parseDelimitedStream, type ParserOptions } from './csvParser';
import type { MaterializedRow } from './utils/materializeRowBatch';
import { detectCompression } from './utils/detectCompression';
import {
  RowIndexStore,
  type RowIndexData,
  findNearestCheckpoint
} from './rowIndexStore';
import { groupMaterializedRows, normaliseGroupColumns } from './groupEngine';
import { RowBatchStore } from './rowBatchStore';
import type {
  ColumnType,
  ColumnInference,
  Delimiter,
  FilterNode,
  GroupingRequest,
  GroupingResult,
  LabelDefinition,
  RowBatch,
  SortDefinition,
  TagRowsRequest,
  TagRowsResponse,
  TaggingSnapshot,
  ExportTagsResponse,
  UpdateLabelRequest,
  DeleteLabelRequest,
  ImportTagsRequest,
  TagRecord
} from './types';
import { evaluateFilterOnRows } from './filterEngine';
import type { SearchRequest, SearchResult } from './searchEngine';
import { shouldPreferDuckDb, tryGroupWithDuckDb } from './duckDbPlan';

export type {
  GroupingRequest,
  GroupingResult,
  TaggingSnapshot,
  TagRowsRequest,
  TagRowsResponse,
  ExportTagsResponse,
  UpdateLabelRequest,
  DeleteLabelRequest,
  ImportTagsRequest,
  LabelDefinition,
  TagRecord
} from './types';

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

export interface LoadCompleteSummary {
  rowsParsed: number;
  bytesParsed: number;
  durationMs: number;
  columnTypes: Record<string, ColumnType>;
  columnInference: Record<string, ColumnInference>;
}

export interface LoadFileCallbacks {
  onStart?: (payload: { columns: string[] }) => void | Promise<void>;
  onProgress?: (progress: { rowsParsed: number; bytesParsed: number; batchesStored: number }) => void | Promise<void>;
  onComplete?: (summary: LoadCompleteSummary) => void | Promise<void>;
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

export interface FetchRowsRequest {
  offset: number;
  limit: number;
}

export interface FetchRowsResult {
  rows: MaterializedRow[];
  totalRows: number;
  matchedRows: number;
}

export interface DataWorkerApi {
  init: (options: WorkerInitOptions) => Promise<void>;
  ping: () => Promise<string>;
  loadFile: (request: LoadFileRequest, callbacks: LoadFileCallbacks) => Promise<void>;
  loadRowIndex: (handle: FileSystemFileHandle) => Promise<RowIndexData | null>;
  seekRows: (request: SeekRowsRequest) => Promise<SeekRowsResult | null>;
  applySorts: (request: ApplySortRequest) => Promise<ApplySortResult>;
  applyFilter: (request: ApplyFilterRequest) => Promise<ApplyFilterResult>;
  fetchRows: (request: FetchRowsRequest) => Promise<FetchRowsResult>;
  groupBy: (request: GroupingRequest) => Promise<GroupingResult>;
  globalSearch: (request: SearchRequest) => Promise<SearchResult>;
  loadTags: () => Promise<TaggingSnapshot>;
  tagRows: (request: TagRowsRequest) => Promise<TagRowsResponse>;
  clearTag: (rowIds: number[]) => Promise<TagRowsResponse>;
  updateLabel: (request: UpdateLabelRequest) => Promise<LabelDefinition>;
  deleteLabel: (request: DeleteLabelRequest) => Promise<{ deleted: boolean }>;
  exportTags: () => Promise<ExportTagsResponse>;
  importTags: (request: ImportTagsRequest) => Promise<TaggingSnapshot>;
}

const state: {
  options: Required<WorkerInitOptions>;
  dataset: {
    batchStore: RowBatchStore | null;
    datasetKey: string | null;
    header: string[];
    columnTypes: Record<string, ColumnType>;
    columnInference: Record<string, ColumnInference>;
    filterRowIds: Uint32Array | null;
    filterExpression: FilterNode | null;
    sorts: SortDefinition[];
    sortedRowIds: Uint32Array | null;
    totalRows: number;
    bytesParsed: number;
    fileHandle: FileSystemFileHandle | null;
  };
  tagging: {
    labels: LabelDefinition[];
    tags: Record<number, TagRecord>;
  };
} = {
  options: {
    enableDuckDb: false,
    chunkSize: 1_048_576
  },
  dataset: {
    batchStore: null,
    datasetKey: null,
    header: [],
    columnTypes: {},
    columnInference: {},
    filterRowIds: null,
    filterExpression: null,
    sorts: [],
    sortedRowIds: null,
    totalRows: 0,
    bytesParsed: 0,
    fileHandle: null
  },
  tagging: {
    labels: [],
    tags: {}
  }
};

const ensureBatchStore = (): RowBatchStore => {
  if (!state.dataset.batchStore) {
    throw new Error('No dataset loaded');
  }

  return state.dataset.batchStore;
};

const getActiveRowOrder = (): Uint32Array | null => {
  return state.dataset.sortedRowIds ?? state.dataset.filterRowIds;
};

const getActiveRowCount = (): number => {
  const order = getActiveRowOrder();
  return order ? order.length : state.dataset.totalRows;
};

const buildRowIdWindow = (offset: number, limit?: number): number[] => {
  const order = getActiveRowOrder();
  const total = order ? order.length : state.dataset.totalRows;
  const start = Math.max(0, offset);
  const end = typeof limit === 'number' ? Math.min(total, start + Math.max(0, limit)) : total;

  if (start >= end) {
    return [];
  }

  if (order) {
    const rowIds: number[] = [];
    for (let index = start; index < end; index += 1) {
      const rowId = order[index];
      if (rowId != null) {
        rowIds.push(rowId);
      }
    }
    return rowIds;
  }

  const rowIds: number[] = [];
  for (let index = start; index < end; index += 1) {
    rowIds.push(index);
  }
  return rowIds;
};

const materializeViewWindow = async (offset: number, limit?: number): Promise<MaterializedRow[]> => {
  const rowIds = buildRowIdWindow(offset, limit);
  if (import.meta.env.DEV) {
    console.debug('[data-worker] materializeViewWindow', {
      offset,
      limit,
      requested: rowIds.length,
      firstRowId: rowIds[0],
      lastRowId: rowIds[rowIds.length - 1],
      activeRowCount: getActiveRowCount()
    });
  }
  if (!rowIds.length) {
    return [];
  }

  const batchStore = ensureBatchStore();
  const rows = await batchStore.materializeRows(rowIds);
  if (import.meta.env.DEV) {
    console.debug('[data-worker] materializeViewWindow resolved', {
      offset,
      limit,
      resolved: rows.length
    });
  }
  return rows;
};

const compareStringValues = (a: unknown, b: unknown): number => {
  const aStr = a == null ? '' : String(a);
  const bStr = b == null ? '' : String(b);
  return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' });
};

const compareNumericValues = (a: unknown, b: unknown): number => {
  const aNum = typeof a === 'number' ? a : Number(a);
  const bNum = typeof b === 'number' ? b : Number(b);

  const aValid = Number.isFinite(aNum);
  const bValid = Number.isFinite(bNum);

  if (!aValid && !bValid) {
    return 0;
  }

  if (!aValid) {
    return 1;
  }

  if (!bValid) {
    return -1;
  }

  if (aNum === bNum) {
    return 0;
  }

  return aNum < bNum ? -1 : 1;
};

const compareBooleanValues = (a: unknown, b: unknown): number => {
  const aBool = typeof a === 'boolean' ? a : Boolean(a);
  const bBool = typeof b === 'boolean' ? b : Boolean(b);

  if (aBool === bBool) {
    return 0;
  }

  return aBool ? 1 : -1;
};

const compareDatetimeValues = (a: unknown, b: unknown): number => {
  const toTimestamp = (value: unknown): number => {
    if (typeof value === 'number') {
      return value;
    }
    if (value == null) {
      return Number.NaN;
    }
    return Date.parse(String(value));
  };

  const aTime = toTimestamp(a);
  const bTime = toTimestamp(b);

  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);

  if (!aValid && !bValid) {
    return 0;
  }

  if (!aValid) {
    return 1;
  }

  if (!bValid) {
    return -1;
  }

  if (aTime === bTime) {
    return 0;
  }

  return aTime < bTime ? -1 : 1;
};

const compareValues = (type: ColumnType, left: unknown, right: unknown): number => {
  switch (type) {
    case 'number':
      return compareNumericValues(left, right);
    case 'boolean':
      return compareBooleanValues(left, right);
    case 'datetime':
      return compareDatetimeValues(left, right);
    case 'string':
    default:
      return compareStringValues(left, right);
  }
};

const normaliseSearchValue = (value: unknown, caseSensitive: boolean): string => {
  const stringValue = String(value ?? '');
  return caseSensitive ? stringValue : stringValue.toLowerCase();
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

    if (state.dataset.batchStore) {
      try {
        await state.dataset.batchStore.clear();
      } catch (error) {
        console.warn('[data-worker] Failed to clear existing batch store', error);
      }
    }

    const datasetKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const batchStore = await RowBatchStore.create(datasetKey);

    state.dataset.batchStore = batchStore;
    state.dataset.datasetKey = datasetKey;
    state.dataset.header = [];
    state.dataset.columnTypes = {};
    state.dataset.columnInference = {};
    state.dataset.filterRowIds = null;
    state.dataset.filterExpression = null;
    state.dataset.sorts = [];
    state.dataset.sortedRowIds = null;
    state.dataset.totalRows = 0;
    state.dataset.bytesParsed = 0;
    state.dataset.fileHandle = handle;

    const file = await handle.getFile();
    const compression = detectCompression({
      fileName: file.name ?? handle.name,
      mimeType: file.type
    });

    let stream: ReadableStream<Uint8Array> = file.stream();

    if (compression === 'gzip') {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser does not support gzip decompression.');
      }

      try {
        stream = stream.pipeThrough(new DecompressionStream('gzip'));
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? `Failed to decompress gzip stream: ${error.message}`
            : 'Failed to decompress gzip stream'
        );
      }
    }

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
    let storedBatches = 0;
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
            state.dataset.header = header;
            if (callbacks.onStart) {
              await callbacks.onStart({ columns: header });
            }
          },
          onBatch: async (batch) => {
            finalRows = batch.stats.rowsParsed;
            finalBytes = batch.stats.bytesParsed;
            storedBatches += 1;

            await batchStore.storeBatch(batch);

            state.dataset.columnTypes = {
              ...state.dataset.columnTypes,
              ...batch.columnTypes
            };
            state.dataset.columnInference = {
              ...state.dataset.columnInference,
              ...batch.columnInference
            };

            if (callbacks.onProgress) {
              await callbacks.onProgress({
                rowsParsed: finalRows,
                bytesParsed: finalBytes,
                batchesStored: storedBatches
              });
            }
          },
          onCheckpoint: async ({ rowIndex, byteOffset }) => {
            indexStore.record({ rowIndex, byteOffset });
          }
        },
        options
      );

      state.dataset.totalRows = finalRows;
      state.dataset.bytesParsed = finalBytes;

      if (callbacks.onComplete) {
        const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        await callbacks.onComplete({
          rowsParsed: finalRows,
          bytesParsed: finalBytes,
          durationMs: endTime - startTime,
          columnTypes: state.dataset.columnTypes,
          columnInference: state.dataset.columnInference
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
    const totalRows = state.dataset.totalRows;

    if (!totalRows) {
      state.dataset.sorts = [];
      state.dataset.sortedRowIds = null;
      return { rows: [], totalRows: 0, matchedRows: 0, sorts: [] };
    }

    const batchStore = state.dataset.batchStore;
    if (!batchStore) {
      return { rows: [], totalRows: 0, matchedRows: 0, sorts: [] };
    }

    const validSorts = sorts.filter((sort) => state.dataset.columnTypes[sort.column] != null);
    state.dataset.sorts = validSorts;
    state.dataset.sortedRowIds = null;

    if (!validSorts.length) {
      const rows = await materializeViewWindow(offset, limit);
      return {
        rows,
        totalRows,
        matchedRows: getActiveRowCount(),
        sorts: []
      };
    }

    const baseRowIds = state.dataset.filterRowIds
      ? Array.from(state.dataset.filterRowIds)
      : Array.from({ length: totalRows }, (_, index) => index);

    if (!baseRowIds.length) {
      return { rows: [], totalRows, matchedRows: 0, sorts: validSorts };
    }

    const rowIndexMap = new Map<number, number>();
    baseRowIds.forEach((rowId, index) => {
      rowIndexMap.set(rowId, index);
    });

    const valueVectors = validSorts.map(() => new Array<unknown>(baseRowIds.length));

    for await (const { rowStart, rows } of batchStore.iterateMaterializedBatches()) {
      for (let idx = 0; idx < rows.length; idx += 1) {
        const row = rows[idx]!;
        const absoluteRowId = rowStart + idx;
        const position = rowIndexMap.get(absoluteRowId);
        if (position == null) {
          continue;
        }

        for (let sortIdx = 0; sortIdx < validSorts.length; sortIdx += 1) {
          const sort = validSorts[sortIdx]!;
          valueVectors[sortIdx]![position] = row[sort.column];
        }
      }
    }

    const sortedRowIdsArray = baseRowIds.slice();
    sortedRowIdsArray.sort((leftId, rightId) => {
      for (let sortIdx = 0; sortIdx < validSorts.length; sortIdx += 1) {
        const sort = validSorts[sortIdx]!;
        const columnType = state.dataset.columnTypes[sort.column] ?? 'string';
        const values = valueVectors[sortIdx]!;
        const leftValue = values[rowIndexMap.get(leftId)!];
        const rightValue = values[rowIndexMap.get(rightId)!];
        const comparison = compareValues(columnType, leftValue, rightValue);

        if (comparison !== 0) {
          return sort.direction === 'desc' ? -comparison : comparison;
        }
      }
      return leftId - rightId;
    });

    state.dataset.sortedRowIds = Uint32Array.from(sortedRowIdsArray);

    const rows = await materializeViewWindow(offset, limit);
    return {
      rows,
      totalRows,
      matchedRows: sortedRowIdsArray.length,
      sorts: validSorts
    };
  },
  async applyFilter({ expression, offset = 0, limit }: ApplyFilterRequest): Promise<ApplyFilterResult> {
    state.dataset.filterExpression = expression;
    state.dataset.filterRowIds = null;
    state.dataset.sortedRowIds = null;

    const totalRows = state.dataset.totalRows;

    if (!totalRows) {
      return { rows: [], totalRows: 0, matchedRows: 0, expression };
    }

    if (!expression) {
      const rows = await materializeViewWindow(offset, limit);
      return {
        rows,
        totalRows,
        matchedRows: totalRows,
        expression
      };
    }

    const batchStore = state.dataset.batchStore;
    if (!batchStore) {
      return {
        rows: [],
        totalRows,
        matchedRows: 0,
        expression
      };
    }

    const matchedRowIds: number[] = [];

    for await (const { rowStart, rows } of batchStore.iterateMaterializedBatches()) {
      const { matches } = evaluateFilterOnRows(rows, state.dataset.columnTypes, expression);
      for (let idx = 0; idx < matches.length; idx += 1) {
        if (matches[idx] === 1) {
          matchedRowIds.push(rowStart + idx);
        }
      }
    }

    state.dataset.filterRowIds = Uint32Array.from(matchedRowIds);

    const rows = await materializeViewWindow(offset, limit);
    return {
      rows,
      totalRows,
      matchedRows: matchedRowIds.length,
      expression
    };
  },
  async fetchRows({ offset, limit }: FetchRowsRequest): Promise<FetchRowsResult> {
    if (import.meta.env.DEV) {
      console.debug('[data-worker] fetchRows request', {
        offset,
        limit,
        hasBatchStore: Boolean(state.dataset.batchStore),
        totalRows: state.dataset.totalRows,
        activeRowCount: getActiveRowCount()
      });
    }
    if (!state.dataset.batchStore) {
      if (import.meta.env.DEV) {
        console.warn('[data-worker] fetchRows received request before dataset ready');
      }
      return {
        rows: [],
        totalRows: 0,
        matchedRows: 0
      };
    }

    const rows = await materializeViewWindow(offset, limit);
    if (import.meta.env.DEV) {
      console.debug('[data-worker] fetchRows resolved', {
        offset,
        limit,
        rows: rows.length,
        totalRows: state.dataset.totalRows,
        matchedRows: getActiveRowCount()
      });
    }
    return {
      rows,
      totalRows: state.dataset.totalRows,
      matchedRows: getActiveRowCount()
    };
  },
  async groupBy(request: GroupingRequest): Promise<GroupingResult> {
    const batchStore = state.dataset.batchStore;
    if (!batchStore) {
      return {
        groupBy: normaliseGroupColumns(request.groupBy),
        rows: [],
        totalGroups: 0,
        totalRows: 0
      };
    }

    const groupColumns = normaliseGroupColumns(request.groupBy);
    const normalisedRequest: GroupingRequest = {
      ...request,
      groupBy: groupColumns
    };

    const currentOrder = getActiveRowOrder();
    const collectedRows: MaterializedRow[] = [];

    if (currentOrder && currentOrder.length) {
      const idsArray = Array.from(currentOrder);
      const chunkSize = 10_000;
      for (let start = 0; start < idsArray.length; start += chunkSize) {
        const slice = idsArray.slice(start, start + chunkSize);
        const chunk = await batchStore.materializeRows(slice);
        collectedRows.push(...chunk);
      }
    } else {
      for await (const { rows } of batchStore.iterateMaterializedBatches()) {
        collectedRows.push(...rows);
      }
    }

    if (!collectedRows.length) {
      return {
        groupBy: groupColumns,
        rows: [],
        totalGroups: 0,
        totalRows: 0
      };
    }

    if (
      state.options.enableDuckDb &&
      shouldPreferDuckDb(normalisedRequest, state.dataset.columnTypes, collectedRows.length)
    ) {
      const duckResult = await tryGroupWithDuckDb(
        collectedRows,
        state.dataset.columnTypes,
        normalisedRequest
      );

      if (duckResult) {
        return duckResult;
      }
    }

    return groupMaterializedRows(collectedRows, state.dataset.columnTypes, normalisedRequest);
  },
  async globalSearch(request: SearchRequest): Promise<SearchResult> {
    const batchStore = state.dataset.batchStore;
    if (!batchStore) {
      return {
        rows: [],
        totalRows: 0,
        matchedRows: 0
      };
    }

    const totalRows = state.dataset.totalRows;
    if (!totalRows) {
      return {
        rows: [],
        totalRows: 0,
        matchedRows: 0
      };
    }

    const limit = typeof request.limit === 'number' ? Math.max(1, request.limit) : 500;
    const caseSensitive = Boolean(request.caseSensitive);
    const trimmed = request.query.trim();
    const columns =
      request.columns.length > 0
        ? request.columns.filter((column) => state.dataset.columnTypes[column] != null)
        : Object.keys(state.dataset.columnTypes);

    if (!trimmed) {
      const rows = await materializeViewWindow(0, limit);
      return {
        rows,
        totalRows,
        matchedRows: rows.length
      };
    }

    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
    const matched: MaterializedRow[] = [];

    for await (const { rows } of batchStore.iterateMaterializedBatches()) {
      let filterMatches: Uint8Array | null = null;
      if (request.filter) {
        filterMatches = evaluateFilterOnRows(rows, state.dataset.columnTypes, request.filter).matches;
      }

      for (let idx = 0; idx < rows.length; idx += 1) {
        if (filterMatches && filterMatches[idx] !== 1) {
          continue;
        }

        const row = rows[idx]!;
        const found = columns.some((column) =>
          normaliseSearchValue(row[column], caseSensitive).includes(needle)
        );

        if (found) {
          matched.push(row);
          if (matched.length >= limit) {
            return {
              rows: matched,
              totalRows,
              matchedRows: matched.length
            };
          }
        }
      }
    }

    return {
      rows: matched,
      totalRows,
      matchedRows: matched.length
    };
  },
  async loadTags(): Promise<TaggingSnapshot> {
    return {
      labels: state.tagging.labels,
      tags: state.tagging.tags
    };
  },
  async tagRows({ rowIds, labelId, note }: TagRowsRequest): Promise<TagRowsResponse> {
    const now = Date.now();
    const label = labelId ? state.tagging.labels.find((entry) => entry.id === labelId) : undefined;
    const updated: TagRowsResponse['updated'] = {};

    for (const rowId of rowIds) {
      const record: TagRecord = {
        labelId: labelId ?? null,
        note,
        color: label?.color,
        updatedAt: now
      };
      state.tagging.tags[rowId] = record;
      updated[rowId] = record;
    }

    return { updated };
  },
  async clearTag(rowIds: number[]): Promise<TagRowsResponse> {
    const now = Date.now();
    const updated: TagRowsResponse['updated'] = {};

    for (const rowId of rowIds) {
      delete state.tagging.tags[rowId];
      updated[rowId] = {
        labelId: null,
        updatedAt: now
      };
    }

    return { updated };
  },
  async updateLabel({ label }: UpdateLabelRequest): Promise<LabelDefinition> {
    const existingIndex = state.tagging.labels.findIndex((entry) => entry.id === label.id);
    const nextLabel: LabelDefinition = {
      ...label,
      createdAt: label.createdAt ?? Date.now(),
      updatedAt: Date.now()
    };

    if (existingIndex >= 0) {
      state.tagging.labels[existingIndex] = nextLabel;
    } else {
      state.tagging.labels.push(nextLabel);
    }

    return nextLabel;
  },
  async deleteLabel({ labelId }: DeleteLabelRequest): Promise<{ deleted: boolean }> {
    const before = state.tagging.labels.length;
    state.tagging.labels = state.tagging.labels.filter((label) => label.id !== labelId);

    for (const [rowId, record] of Object.entries(state.tagging.tags)) {
      if (record.labelId === labelId) {
        state.tagging.tags[Number(rowId)] = {
          labelId: null,
          updatedAt: Date.now()
        };
      }
    }

    return { deleted: state.tagging.labels.length < before };
  },
  async exportTags(): Promise<ExportTagsResponse> {
    return {
      labels: state.tagging.labels,
      tags: state.tagging.tags,
      exportedAt: Date.now()
    };
  },
  async importTags(request: ImportTagsRequest): Promise<TaggingSnapshot> {
    if (request.mergeStrategy === 'replace') {
      state.tagging.labels = request.labels;
      state.tagging.tags = request.tags;
    } else {
      const merged: Record<string, LabelDefinition> = {};
      for (const label of state.tagging.labels) {
        merged[label.id] = label;
      }
      for (const label of request.labels) {
        merged[label.id] = label;
      }

      state.tagging.labels = Object.values(merged);
      state.tagging.tags = {
        ...state.tagging.tags,
        ...request.tags
      };
    }

    return {
      labels: state.tagging.labels,
      tags: state.tagging.tags
    };
  }
};

expose(api);
