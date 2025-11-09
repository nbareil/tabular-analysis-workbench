import { expose } from 'comlink';

import { parseDelimitedStream, type ParserOptions } from './csvParser';
import { FuzzyIndexBuilder } from './fuzzyIndexBuilder';
import { damerauLevenshtein } from './utils/levenshtein';
import { normalizeValue } from './utils/stringUtils';
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
  DeleteLabelResponse,
  ImportTagsRequest,
  TagRecord
} from './types';
import { evaluateFilterOnRows } from './filterEngine';
import type { SearchRequest, SearchResult } from './searchEngine';
import { shouldPreferDuckDb, tryGroupWithDuckDb } from './duckDbPlan';
import { sortRowIds, sortRowIdsProgressive } from './sortEngine';
import {
  FuzzyIndexStore,
  type FuzzyIndexSnapshot,
  type FuzzyIndexFingerprint,
  type FuzzyColumnSnapshot,
  FUZZY_INDEX_STORE_VERSION
} from './fuzzyIndexStore';
import { createFuzzyFingerprint, fuzzySnapshotMatchesFingerprint } from './fuzzyIndexUtils';
import { logDebug } from '../utils/debugLog';
import { TaggingStore } from './taggingStore';
import { buildTagRecord, cascadeLabelDeletion, isTagRecordEmpty } from './taggingHelpers';

export type {
  GroupingRequest,
  GroupingResult,
  TaggingSnapshot,
  TagRowsRequest,
  TagRowsResponse,
  ExportTagsResponse,
  UpdateLabelRequest,
  DeleteLabelRequest,
  DeleteLabelResponse,
  ImportTagsRequest,
  LabelDefinition,
  TagRecord
} from './types';

export type { FuzzyIndexSnapshot } from './fuzzyIndexStore';

export interface WorkerInitOptions {
  enableDuckDb?: boolean;
  chunkSize?: number;
  debugLogging?: boolean;
  slowBatchThresholdMs?: number;
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

export interface GlobalSearchResult {
  rows: number[];
  totalRows: number;
  matchedRows: number;
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

export interface PersistFuzzyIndexRequest {
  createdAt?: number;
  rowCount: number;
  bytesParsed: number;
  tokenLimit: number;
  trigramSize: number;
  columns: FuzzyColumnSnapshot[];
}

export interface ApplySortRequest {
  sorts: SortDefinition[];
  offset?: number;
  limit?: number;
  progressive?: boolean;
  visibleRows?: number;
}

export interface ApplySortResult {
  rows: MaterializedRow[];
  totalRows: number;
  matchedRows: number;
  sorts: SortDefinition[];
  sortComplete?: boolean;
  sortedRowCount?: number;
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
  fuzzyUsed?: import('./filterEngine').FuzzyMatchInfo;
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
  globalSearch: (request: SearchRequest) => Promise<GlobalSearchResult>;
  fetchRowsByIds: (rowIds: number[]) => Promise<MaterializedRow[]>;
  loadTags: () => Promise<TaggingSnapshot>;
  tagRows: (request: TagRowsRequest) => Promise<TagRowsResponse>;
  clearTag: (rowIds: number[]) => Promise<TagRowsResponse>;
  updateLabel: (request: UpdateLabelRequest) => Promise<LabelDefinition>;
  deleteLabel: (request: DeleteLabelRequest) => Promise<DeleteLabelResponse>;
  exportTags: () => Promise<ExportTagsResponse>;
  importTags: (request: ImportTagsRequest) => Promise<TaggingSnapshot>;
  getFuzzyIndexSnapshot: () => Promise<FuzzyIndexSnapshot | null>;
  persistFuzzyIndexSnapshot: (
    request: PersistFuzzyIndexRequest
  ) => Promise<FuzzyIndexSnapshot | null>;
  clearFuzzyIndexSnapshot: () => Promise<void>;
  persistTags: () => Promise<void>;
}

const state: {
  options: {
    enableDuckDb: boolean;
    chunkSize: number;
    debugLogging: boolean;
    slowBatchThresholdMs: number;
  };
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
    fuzzyIndexStore: FuzzyIndexStore | null;
    fuzzyIndexSnapshot: FuzzyIndexSnapshot | null;
    fuzzyFingerprint: FuzzyIndexFingerprint | null;
    backgroundSortPromise: Promise<Uint32Array | void> | null;
    sortComplete: boolean;
  };
  tagging: {
    labels: LabelDefinition[];
    tags: Record<number, TagRecord>;
    store: TaggingStore | null;
    dirty: boolean;
    persistTimer: number | null;
  };
} = {
  options: {
    enableDuckDb: false,
    chunkSize: 1_048_576,
    debugLogging: false,
    slowBatchThresholdMs: 32
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
    fileHandle: null,
    fuzzyIndexStore: null,
    fuzzyIndexSnapshot: null,
    fuzzyFingerprint: null,
    backgroundSortPromise: null,
    sortComplete: true
  },
  tagging: {
    labels: [],
    tags: {},
    store: null,
    dirty: false,
    persistTimer: null
  }
};

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const roundMs = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100) / 100;
};

const TAG_PERSIST_DEBOUNCE_MS = 30_000;
const DEFAULT_LABEL_COLOR = '#8899ff';

const generateRandomId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const clearTaggingPersistTimer = (): void => {
  if (state.tagging.persistTimer != null) {
    clearTimeout(state.tagging.persistTimer);
    state.tagging.persistTimer = null;
  }
};

const persistTaggingNow = async (): Promise<void> => {
  if (!state.tagging.store || !state.tagging.dirty) {
    return;
  }

  try {
    await state.tagging.store.save({
      labels: state.tagging.labels,
      tags: state.tagging.tags
    });
    state.tagging.dirty = false;
  } catch (error) {
    console.warn('[data-worker][tagging] Failed to persist snapshot', error);
  }
};

const scheduleTaggingPersist = (): void => {
  if (!state.tagging.store) {
    return;
  }

  clearTaggingPersistTimer();
  state.tagging.persistTimer = setTimeout(() => {
    void persistTaggingNow();
  }, TAG_PERSIST_DEBOUNCE_MS) as unknown as number;
};

const resetTaggingState = (): void => {
  clearTaggingPersistTimer();
  state.tagging.labels = [];
  state.tagging.tags = {};
  state.tagging.store = null;
  state.tagging.dirty = false;
};

const hydrateTaggingStore = async (): Promise<void> => {
  clearTaggingPersistTimer();

  try {
    const store = await TaggingStore.create();
    state.tagging.store = store;

    const snapshot = await store.load();
    if (snapshot) {
      state.tagging.labels = snapshot.labels ?? [];
      state.tagging.tags = snapshot.tags ?? {};
      state.tagging.dirty = false;
    } else {
      state.tagging.labels = [];
      state.tagging.tags = {};
      state.tagging.dirty = false;
    }
  } catch (error) {
    console.warn('[data-worker][tagging] Failed to hydrate tagging store', error);
    state.tagging.store = null;
    state.tagging.labels = [];
    state.tagging.tags = {};
    state.tagging.dirty = false;
  }
};

const markTaggingDirty = (): void => {
  state.tagging.dirty = true;
  scheduleTaggingPersist();
};

const normaliseImportedLabel = (label: LabelDefinition, fallbackTimestamp: number): LabelDefinition => {
  const safeId =
    typeof label.id === 'string' && label.id.trim().length > 0 ? label.id.trim() : generateRandomId();
  const safeName =
    typeof label.name === 'string' && label.name.trim().length > 0 ? label.name.trim() : 'Untitled label';
  const safeColor =
    typeof label.color === 'string' && label.color.trim().length > 0
      ? label.color.trim()
      : DEFAULT_LABEL_COLOR;
  const createdAt =
    typeof label.createdAt === 'number' && Number.isFinite(label.createdAt)
      ? label.createdAt
      : fallbackTimestamp;
  const updatedAt =
    typeof label.updatedAt === 'number' && Number.isFinite(label.updatedAt)
      ? label.updatedAt
      : fallbackTimestamp;
  const description =
    typeof label.description === 'string' && label.description.trim().length > 0
      ? label.description.trim()
      : undefined;

  return {
    id: safeId,
    name: safeName,
    color: safeColor,
    description,
    createdAt,
    updatedAt
  };
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
    logDebug('data-worker', 'materializeViewWindow', {
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
    logDebug('data-worker', 'materializeViewWindow resolved', {
      offset,
      limit,
      resolved: rows.length
    });
  }
  return rows;
};







const api: DataWorkerApi = {
  async init(options) {
    const previous = state.options;
    const threshold = options.slowBatchThresholdMs;

    state.options = {
      enableDuckDb: options.enableDuckDb ?? previous.enableDuckDb,
      chunkSize: options.chunkSize ?? previous.chunkSize,
      debugLogging:
        typeof options.debugLogging === 'boolean' ? options.debugLogging : previous.debugLogging,
      slowBatchThresholdMs:
        typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 0
          ? threshold
          : previous.slowBatchThresholdMs
    };
  },
  async ping() {
    return 'pong';
  },
  async loadFile({ handle, delimiter, batchSize, encoding, checkpointInterval }, callbacks) {
    if (!handle) {
      throw new Error('A file handle must be provided to loadFile.');
    }

    await persistTaggingNow();
    resetTaggingState();

    const debugEnabled = state.options.debugLogging;
    const slowBatchThreshold = state.options.slowBatchThresholdMs;
    let datasetKey = 'pending';
    const debugLog = (event: string, payload?: Record<string, unknown>) => {
      if (!debugEnabled) {
        return;
      }

      logDebug(`data-worker][dataset:${datasetKey}`, event, payload);
    };

    if (state.dataset.batchStore) {
      const clearStart = now();
      try {
        await state.dataset.batchStore.clear();
        debugLog('Cleared existing batch store', { durationMs: roundMs(now() - clearStart) });
      } catch (error) {
        console.warn('[data-worker] Failed to clear existing batch store', error);
        debugLog('Failed clearing existing batch store', {
          durationMs: roundMs(now() - clearStart),
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    datasetKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const batchStoreStart = now();
    const batchStore = await RowBatchStore.create(datasetKey);
    debugLog('RowBatchStore.create completed', { durationMs: roundMs(now() - batchStoreStart) });

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
    state.dataset.fuzzyIndexStore = null;
    state.dataset.fuzzyIndexSnapshot = null;
    state.dataset.fuzzyFingerprint = null;

    const fileStart = now();
    const file = await handle.getFile();
    debugLog('handle.getFile resolved', {
      durationMs: roundMs(now() - fileStart),
      name: file.name ?? handle.name ?? 'unknown',
      size: file.size,
      type: file.type
    });

    const fuzzyFingerprint = createFuzzyFingerprint(file, handle);
    const fuzzyStoreStart = now();
    const fuzzyIndexStore = await FuzzyIndexStore.create(handle);
    debugLog('FuzzyIndexStore.create completed', {
      durationMs: roundMs(now() - fuzzyStoreStart)
    });
    state.dataset.fuzzyIndexStore = fuzzyIndexStore;
    state.dataset.fuzzyFingerprint = fuzzyFingerprint;

    const cachedFuzzyIndex = await fuzzyIndexStore.load();
    let fuzzyIndexBuilder: FuzzyIndexBuilder | undefined;

    if (
      cachedFuzzyIndex &&
      fuzzySnapshotMatchesFingerprint(cachedFuzzyIndex, fuzzyFingerprint)
    ) {
      state.dataset.fuzzyIndexSnapshot = cachedFuzzyIndex;
      debugLog('Hydrated fuzzy index snapshot from cache', {
        createdAt: cachedFuzzyIndex.createdAt,
        columnCount: cachedFuzzyIndex.columns.length,
        tokenLimit: cachedFuzzyIndex.tokenLimit
      });
    } else {
      if (cachedFuzzyIndex) {
        debugLog('Discarded stale fuzzy index snapshot', {
          cachedFingerprint: cachedFuzzyIndex.fingerprint,
          expectedFingerprint: fuzzyFingerprint
        });
        await fuzzyIndexStore.clear();
      }

      // Create builder to build fuzzy index from scratch
      fuzzyIndexBuilder = new FuzzyIndexBuilder();
      debugLog('Created new FuzzyIndexBuilder for parsing');
    }

    await hydrateTaggingStore();

    const compression = detectCompression({
      fileName: file.name ?? handle.name,
      mimeType: file.type
    });
    debugLog('Compression detected', { compression: compression ?? 'none' });

    let stream: ReadableStream<Uint8Array> = file.stream();

    if (compression === 'gzip') {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser does not support gzip decompression.');
      }

      try {
        stream = stream.pipeThrough(new DecompressionStream('gzip') as any);
        debugLog('Applied gzip DecompressionStream');
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
      checkpointInterval: targetCheckpointInterval,
      fuzzyIndexBuilder
    };

    const startTime = now();
    let finalRows = 0;
    let finalBytes = 0;
    let storedBatches = 0;
    let previousRowsParsed = 0;
    let previousBytesParsed = 0;

    let totalStoreDurationMs = 0;
    let longestStoreDurationMs = 0;
    let slowStoreBatchCount = 0;

    let totalProgressCallbackMs = 0;
    let longestProgressCallbackMs = 0;

    let checkpointCount = 0;
    let totalCheckpointMs = 0;
    let longestCheckpointMs = 0;

    let chunkCount = 0;
    let totalReadMs = 0;
    let longestReadMs = 0;

    const indexStoreStart = now();
    const indexStore = await RowIndexStore.create(handle, {
      checkpointInterval: targetCheckpointInterval
    });
    debugLog('RowIndexStore.create completed', { durationMs: roundMs(now() - indexStoreStart) });

    const source: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const readStart = now();
            const { value, done } = await reader.read();
            const readDuration = now() - readStart;

            if (done) {
              return;
            }

            if (value) {
              chunkCount += 1;
              totalReadMs += readDuration;
              if (readDuration > longestReadMs) {
                longestReadMs = readDuration;
              }

              if (debugEnabled && readDuration >= slowBatchThreshold) {
                debugLog('Slow chunk read', {
                  chunkIndex: chunkCount,
                  readDurationMs: roundMs(readDuration)
                });
              }

              yield value;
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    };

    try {
      debugLog('Starting parseDelimitedStream', {
        delimiter: delimiter ?? 'auto',
        batchSize: batchSize ?? 'default',
        encoding: encoding ?? 'utf-8',
        checkpointInterval: targetCheckpointInterval
      });
      const parseStartTime = now();

      await parseDelimitedStream(
        source,
        {
          onHeader: async (header) => {
            state.dataset.header = header;
            if (callbacks.onStart) {
              const callbackStart = now();
              await callbacks.onStart({ columns: header });
              const duration = now() - callbackStart;
              debugLog('onStart callback completed', {
                durationMs: roundMs(duration),
                columnCount: header.length
              });
              if (duration >= slowBatchThreshold) {
                debugLog('Slow onStart callback detected', {
                  durationMs: roundMs(duration)
                });
              }
            } else {
              debugLog('No onStart callback provided', { columnCount: header.length });
            }
          },
          onBatch: async (batch) => {
            finalRows = batch.stats.rowsParsed;
            finalBytes = batch.stats.bytesParsed;
            storedBatches += 1;

            const rowsInBatch = Math.max(0, finalRows - previousRowsParsed);
            const bytesInBatch = Math.max(0, finalBytes - previousBytesParsed);
            previousRowsParsed = finalRows;
            previousBytesParsed = finalBytes;

            const storeStart = now();
            await batchStore.storeBatch(batch);
            const storeDuration = now() - storeStart;
            totalStoreDurationMs += storeDuration;
            if (storeDuration > longestStoreDurationMs) {
              longestStoreDurationMs = storeDuration;
            }

            const shouldLogBatch =
              storeDuration >= slowBatchThreshold || storedBatches <= 5 || storedBatches % 50 === 0;

            if (storeDuration >= slowBatchThreshold) {
              slowStoreBatchCount += 1;
            }

            if (shouldLogBatch) {
              debugLog('Stored batch', {
                batchesStored: storedBatches,
                rowsInBatch,
                cumulativeRowsParsed: finalRows,
                cumulativeBytesParsed: finalBytes,
                storeDurationMs: roundMs(storeDuration),
                slowStore: storeDuration >= slowBatchThreshold,
                bytesInBatch
              });
            }

            state.dataset.columnTypes = {
              ...state.dataset.columnTypes,
              ...batch.columnTypes
            };
            state.dataset.columnInference = {
              ...state.dataset.columnInference,
              ...batch.columnInference
            };
            state.dataset.totalRows = finalRows;
            state.dataset.bytesParsed = finalBytes;

            if (callbacks.onProgress) {
              const payload = {
                rowsParsed: finalRows,
                bytesParsed: finalBytes,
                batchesStored: storedBatches
              };
              const progressStart = now();
              await callbacks.onProgress(payload);
              const progressDuration = now() - progressStart;
              totalProgressCallbackMs += progressDuration;
              if (progressDuration > longestProgressCallbackMs) {
                longestProgressCallbackMs = progressDuration;
              }

              if (progressDuration >= slowBatchThreshold) {
                debugLog('Slow onProgress callback detected', {
                  durationMs: roundMs(progressDuration),
                  batchesStored: storedBatches
                });
              }
            }
          },
          onCheckpoint: async ({ rowIndex, byteOffset }) => {
            const checkpointStart = now();
            indexStore.record({ rowIndex, byteOffset });
            const checkpointDuration = now() - checkpointStart;
            checkpointCount += 1;
            totalCheckpointMs += checkpointDuration;

            if (checkpointDuration > longestCheckpointMs) {
              longestCheckpointMs = checkpointDuration;
            }

            if (checkpointDuration >= slowBatchThreshold) {
              debugLog('Slow checkpoint record detected', {
                rowIndex,
                byteOffset,
                checkpointDurationMs: roundMs(checkpointDuration)
              });
            }
          }
        },
        options
      );

      debugLog('parseDelimitedStream completed', {
        durationMs: roundMs(now() - parseStartTime),
        storedBatches,
        rowsParsed: finalRows,
        bytesParsed: finalBytes
      });

      state.dataset.totalRows = finalRows;
      state.dataset.bytesParsed = finalBytes;

      // Build and persist fuzzy index if builder was used
      if (fuzzyIndexBuilder) {
        const buildStart = now();
        const columnSnapshots = fuzzyIndexBuilder.buildSnapshots();
        debugLog('FuzzyIndexBuilder.buildSnapshots completed', {
          durationMs: roundMs(now() - buildStart),
          columnCount: columnSnapshots.length
        });

        const fuzzySnapshot = {
          version: FUZZY_INDEX_STORE_VERSION,
          createdAt: Date.now(),
          rowCount: finalRows,
          bytesParsed: finalBytes,
          tokenLimit: 50_000, // from FuzzyIndexBuilder
          trigramSize: 3,
          fingerprint: fuzzyFingerprint,
          columns: columnSnapshots
        };

        const persistStart = now();
        await fuzzyIndexStore.save(fuzzySnapshot);
        debugLog('FuzzyIndexStore.save completed', {
          durationMs: roundMs(now() - persistStart)
        });

        state.dataset.fuzzyIndexSnapshot = fuzzySnapshot;
      }

      if (callbacks.onComplete) {
        const endTime = now();
        const summary: LoadCompleteSummary = {
          rowsParsed: finalRows,
          bytesParsed: finalBytes,
          durationMs: endTime - startTime,
          columnTypes: state.dataset.columnTypes,
          columnInference: state.dataset.columnInference
        };
        const completeStart = now();
        await callbacks.onComplete(summary);
        const completeDuration = now() - completeStart;
        debugLog('onComplete callback completed', {
          durationMs: roundMs(completeDuration),
          rowsParsed: finalRows,
          bytesParsed: finalBytes
        });
        if (completeDuration >= slowBatchThreshold) {
          debugLog('Slow onComplete callback detected', {
            durationMs: roundMs(completeDuration)
          });
        }
      }

      const finalizeStart = now();
      await indexStore.finalize({ rowCount: finalRows, bytesParsed: finalBytes });
      debugLog('RowIndexStore.finalize completed', {
        durationMs: roundMs(now() - finalizeStart),
        rowCount: finalRows,
        bytesParsed: finalBytes
      });

      debugLog('Load complete summary', {
        totalDurationMs: roundMs(now() - startTime),
        rowsParsed: finalRows,
        bytesParsed: finalBytes,
        storedBatches,
        chunkCount,
        slowStoreBatchCount,
        longestStoreBatchMs: roundMs(longestStoreDurationMs),
        averageStoreBatchMs:
          storedBatches > 0 ? roundMs(totalStoreDurationMs / storedBatches) : 0,
        checkpointCount,
        longestCheckpointMs: roundMs(longestCheckpointMs),
        averageCheckpointMs:
          checkpointCount > 0 ? roundMs(totalCheckpointMs / checkpointCount) : 0,
        longestReadMs: roundMs(longestReadMs),
        averageReadMs: chunkCount > 0 ? roundMs(totalReadMs / chunkCount) : 0,
        longestProgressCallbackMs: roundMs(longestProgressCallbackMs),
        totalProgressCallbackMs: roundMs(totalProgressCallbackMs),
        averageProgressCallbackMs:
          storedBatches > 0 ? roundMs(totalProgressCallbackMs / storedBatches) : 0
      });
    } catch (error) {
      debugLog('loadFile encountered error', {
        message: error instanceof Error ? error.message : String(error)
      });
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
  async applySorts({ sorts, offset = 0, limit, progressive = false, visibleRows = 1000 }): Promise<ApplySortResult> {
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

    // Cancel any existing background sort
    if (state.dataset.backgroundSortPromise) {
      // Note: In a real implementation, we'd need a way to cancel the promise
      state.dataset.backgroundSortPromise = null;
    }

    let sortResult;
    if (progressive && baseRowIds.length > visibleRows * 2) {
      // Use progressive sorting for large datasets
      sortResult = await sortRowIdsProgressive(
        batchStore,
        baseRowIds,
        state.dataset.columnTypes,
        validSorts,
        visibleRows
      );

      // Store the background completion promise
      if (sortResult.backgroundPromise) {
        state.dataset.backgroundSortPromise = sortResult.backgroundPromise.then(completeSortedIds => {
          // Update the sortedRowIds with complete results
          state.dataset.sortedRowIds = completeSortedIds;
          state.dataset.sortComplete = true;
          state.dataset.backgroundSortPromise = null;
          return completeSortedIds;
        });
      }

      state.dataset.sortComplete = sortResult.sortComplete;
    } else {
      // Use regular sorting for smaller datasets
      const sortedRowIds = await sortRowIds(
        batchStore,
        baseRowIds,
        state.dataset.columnTypes,
        validSorts
      );
      sortResult = { sortedRowIds, sortComplete: true };
      state.dataset.sortComplete = true;
      state.dataset.backgroundSortPromise = null;
    }

    state.dataset.sortedRowIds = sortResult.sortedRowIds;

    const rows = await materializeViewWindow(offset, limit);
    return {
      rows,
      totalRows,
      matchedRows: baseRowIds.length,
      sorts: validSorts,
      sortComplete: sortResult.sortComplete,
      sortedRowCount: sortResult.sortComplete ? baseRowIds.length : visibleRows
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
    let fuzzyUsed: import('./filterEngine').FuzzyMatchInfo | undefined;

    for await (const { rowStart, rows } of batchStore.iterateMaterializedBatches()) {
      const result = evaluateFilterOnRows(rows, state.dataset.columnTypes, expression, {
        tags: state.tagging.tags,
        fuzzyIndex: state.dataset.fuzzyIndexSnapshot
      });
      for (let idx = 0; idx < result.matches.length; idx += 1) {
        if (result.matches[idx] === 1) {
          matchedRowIds.push(rowStart + idx);
        }
      }
      if (result.fuzzyUsed && !fuzzyUsed) {
        fuzzyUsed = result.fuzzyUsed;
      }
    }

    state.dataset.filterRowIds = Uint32Array.from(matchedRowIds);

    const rows = await materializeViewWindow(offset, limit);
    return {
      rows,
      totalRows,
      matchedRows: matchedRowIds.length,
      expression,
      fuzzyUsed
    };
  },
  async fetchRows({ offset, limit }: FetchRowsRequest): Promise<FetchRowsResult> {
    if (import.meta.env.DEV) {
      logDebug('data-worker', 'fetchRows request', {
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
      logDebug('data-worker', 'fetchRows resolved', {
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
  async globalSearch(request: SearchRequest): Promise<GlobalSearchResult> {
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
        rows: rows.map(row => row.__rowId),
        totalRows,
        matchedRows: rows.length
      };
    }

    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
    const matched: number[] = [];

    for await (const { rowStart, rows } of batchStore.iterateMaterializedBatches()) {
      let filterMatches: Uint8Array | null = null;
      if (request.filter) {
        filterMatches = evaluateFilterOnRows(rows, state.dataset.columnTypes, request.filter, {
          tags: state.tagging.tags,
          fuzzyIndex: state.dataset.fuzzyIndexSnapshot
        }).matches;
      }

      for (let idx = 0; idx < rows.length; idx += 1) {
        if (filterMatches && filterMatches[idx] !== 1) {
          continue;
        }

        const row = rows[idx]!;
        const found = columns.some((column) => {
          const value = normalizeValue(row[column], caseSensitive);
          if (value.includes(needle)) {
            return true;
          }
          if (needle.length <= 10) {
            const distance = damerauLevenshtein(value, needle);
            if (distance <= 2) {
              return true;
            }
          }
          return false;
        });

        if (found) {
          matched.push(rowStart + idx);
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
  async fetchRowsByIds(rowIds: number[]): Promise<MaterializedRow[]> {
    if (!state.dataset.batchStore) {
      return [];
    }
    const uniqueIds = Array.from(new Set(rowIds)).sort((a, b) => a - b);
    const rows = await state.dataset.batchStore.materializeRows(uniqueIds);
    const idToRow = new Map<number, MaterializedRow>();
    uniqueIds.forEach((id, index) => {
      idToRow.set(id, rows[index]!);
    });
    return rowIds.map(id => idToRow.get(id)).filter((row): row is MaterializedRow => row != null);
  },
  async loadTags(): Promise<TaggingSnapshot> {
    return {
      labels: state.tagging.labels,
      tags: state.tagging.tags
    };
  },
  async tagRows({ rowIds, labelId, note }: TagRowsRequest): Promise<TagRowsResponse> {
    const timestamp = Date.now();
    const resolvedLabelId = labelId ?? null;
    const label = resolvedLabelId
      ? state.tagging.labels.find((entry) => entry.id === resolvedLabelId)
      : undefined;
    const updated: TagRowsResponse['updated'] = {};
    let mutated = false;

    for (const rowId of rowIds) {
      if (!Number.isFinite(rowId) || rowId < 0) {
        continue;
      }

      const existing = state.tagging.tags[rowId];
      const record = buildTagRecord({
        existing,
        label,
        labelId: resolvedLabelId,
        note,
        timestamp
      });

      if (isTagRecordEmpty(record)) {
        if (existing) {
          delete state.tagging.tags[rowId];
          mutated = true;
        }
      } else {
        const changed =
          !existing ||
          existing.labelId !== record.labelId ||
          existing.note !== record.note ||
          existing.color !== record.color;
        state.tagging.tags[rowId] = record;
        mutated = mutated || changed;
      }

      updated[rowId] = record;
    }

    if (mutated) {
      markTaggingDirty();
    }

    return { updated };
  },
  async clearTag(rowIds: number[]): Promise<TagRowsResponse> {
    const timestamp = Date.now();
    const updated: TagRowsResponse['updated'] = {};
    let mutated = false;

    for (const rowId of rowIds) {
      if (!Number.isFinite(rowId) || rowId < 0) {
        continue;
      }

      if (state.tagging.tags[rowId]) {
        delete state.tagging.tags[rowId];
        mutated = true;
      }

      updated[rowId] = {
        labelId: null,
        updatedAt: timestamp
      };
    }

    if (mutated) {
      markTaggingDirty();
    }

    return { updated };
  },
  async updateLabel({ label }: UpdateLabelRequest): Promise<LabelDefinition> {
    const timestamp = Date.now();
    const safeName =
      typeof label.name === 'string' && label.name.trim().length > 0
        ? label.name.trim()
        : 'Untitled label';
    const safeColor =
      typeof label.color === 'string' && label.color.trim().length > 0
        ? label.color.trim()
        : DEFAULT_LABEL_COLOR;
    const safeDescription =
      typeof label.description === 'string' && label.description.trim().length > 0
        ? label.description.trim()
        : undefined;
    const existingIndex = state.tagging.labels.findIndex((entry) => entry.id === label.id);
    const nextLabel: LabelDefinition = {
      id: label.id,
      name: safeName,
      color: safeColor,
      description: safeDescription,
      createdAt: typeof label.createdAt === 'number' ? label.createdAt : timestamp,
      updatedAt: timestamp
    };

    if (existingIndex >= 0) {
      state.tagging.labels[existingIndex] = nextLabel;
    } else {
      state.tagging.labels.push(nextLabel);
    }

    for (const [key, record] of Object.entries(state.tagging.tags)) {
      if (record.labelId !== nextLabel.id) {
        continue;
      }

      const rowId = Number(key);
      if (!Number.isFinite(rowId) || rowId < 0) {
        continue;
      }

      state.tagging.tags[rowId] = {
        ...record,
        color: nextLabel.color,
        updatedAt: timestamp
      };
    }

    markTaggingDirty();

    return nextLabel;
  },
  async deleteLabel({ labelId }: DeleteLabelRequest): Promise<DeleteLabelResponse> {
    const before = state.tagging.labels.length;
    state.tagging.labels = state.tagging.labels.filter((label) => label.id !== labelId);
    const timestamp = Date.now();
    const updated: Record<number, TagRecord> = {};

    for (const [rowId, record] of Object.entries(state.tagging.tags)) {
      if (record.labelId === labelId) {
        const numericRowId = Number(rowId);
        if (!Number.isFinite(numericRowId) || numericRowId < 0) {
          continue;
        }

        const nextRecord = cascadeLabelDeletion(record, timestamp);
        if (isTagRecordEmpty(nextRecord)) {
          delete state.tagging.tags[numericRowId];
        } else {
          state.tagging.tags[numericRowId] = nextRecord;
        }

        updated[numericRowId] = nextRecord;
      }
    }

    const deleted = state.tagging.labels.length < before;
    if (deleted || Object.keys(updated).length > 0) {
      markTaggingDirty();
    }

    return { deleted, updated };
  },
  async exportTags(): Promise<ExportTagsResponse> {
    return {
      labels: state.tagging.labels,
      tags: state.tagging.tags,
      exportedAt: Date.now()
    };
  },
  async importTags(request: ImportTagsRequest): Promise<TaggingSnapshot> {
    const strategy = request.mergeStrategy ?? 'merge';
    const timestamp = Date.now();
    const incomingLabels = Array.isArray(request.labels) ? request.labels : [];
    const normalisedIncoming = incomingLabels.map((entry) => normaliseImportedLabel(entry, timestamp));

    const labelMap: Map<string, LabelDefinition> = new Map();
    if (strategy === 'merge') {
      for (const label of state.tagging.labels) {
        labelMap.set(label.id, label);
      }
    }
    for (const label of normalisedIncoming) {
      labelMap.set(label.id, label);
    }
    state.tagging.labels = Array.from(labelMap.values());

    const nextTags: Record<number, TagRecord> =
      strategy === 'merge' ? { ...state.tagging.tags } : {};
    const incomingTags = request.tags ?? {};

    let mutated = strategy === 'replace';

    for (const [rowKey, record] of Object.entries(incomingTags)) {
      const rowId = Number(rowKey);
      if (!Number.isFinite(rowId) || rowId < 0) {
        continue;
      }

      const incomingLabelId =
        typeof record.labelId === 'string' && record.labelId.trim().length > 0
          ? record.labelId.trim()
          : null;
      if (incomingLabelId && !labelMap.has(incomingLabelId)) {
        continue;
      }

      const label = incomingLabelId ? labelMap.get(incomingLabelId) : undefined;
      const note =
        typeof record.note === 'string'
          ? record.note
          : undefined;
      const recordTimestamp =
        typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : timestamp;
      const existing = strategy === 'merge' ? nextTags[rowId] : undefined;
      const nextRecord = buildTagRecord({
        existing,
        label,
        labelId: incomingLabelId,
        note,
        timestamp: recordTimestamp
      });

      if (isTagRecordEmpty(nextRecord)) {
        if (nextTags[rowId]) {
          delete nextTags[rowId];
          mutated = true;
        }
        continue;
      }

      const previous = nextTags[rowId];
      const changed =
        !previous ||
        previous.labelId !== nextRecord.labelId ||
        previous.note !== nextRecord.note ||
        previous.color !== nextRecord.color;

      nextTags[rowId] = nextRecord;
      mutated = mutated || changed;
    }

    state.tagging.tags = nextTags;

    if (mutated || normalisedIncoming.length > 0) {
      markTaggingDirty();
    }

    return {
      labels: state.tagging.labels,
      tags: state.tagging.tags
    };
  },
  async getFuzzyIndexSnapshot(): Promise<FuzzyIndexSnapshot | null> {
    return state.dataset.fuzzyIndexSnapshot;
  },
  async persistFuzzyIndexSnapshot(
    request: PersistFuzzyIndexRequest
  ): Promise<FuzzyIndexSnapshot | null> {
    const fingerprint = state.dataset.fuzzyFingerprint;
    if (!fingerprint) {
      return null;
    }

    if (!Array.isArray(request.columns)) {
      throw new Error('Fuzzy index snapshot requires a columns array.');
    }

    const rowCount =
      typeof request.rowCount === 'number' && Number.isFinite(request.rowCount)
        ? Math.max(0, Math.floor(request.rowCount))
        : state.dataset.totalRows;
    const bytesParsed =
      typeof request.bytesParsed === 'number' && Number.isFinite(request.bytesParsed)
        ? Math.max(0, Math.floor(request.bytesParsed))
        : state.dataset.bytesParsed;
    const tokenLimit =
      typeof request.tokenLimit === 'number' && Number.isFinite(request.tokenLimit)
        ? Math.max(0, Math.floor(request.tokenLimit))
        : 0;
    const trigramSize =
      typeof request.trigramSize === 'number' && Number.isFinite(request.trigramSize)
        ? Math.max(1, Math.floor(request.trigramSize))
        : 3;
    const createdAt =
      typeof request.createdAt === 'number' && Number.isFinite(request.createdAt)
        ? request.createdAt
        : Date.now();

    const snapshot: FuzzyIndexSnapshot = {
      version: FUZZY_INDEX_STORE_VERSION,
      createdAt,
      rowCount,
      bytesParsed,
      tokenLimit,
      trigramSize,
      fingerprint,
      columns: request.columns
    };

    state.dataset.fuzzyIndexSnapshot = snapshot;

    if (
      state.dataset.fuzzyIndexStore &&
      fuzzySnapshotMatchesFingerprint(snapshot, fingerprint)
    ) {
      await state.dataset.fuzzyIndexStore.save(snapshot);
    }

    return snapshot;
  },
  async clearFuzzyIndexSnapshot(): Promise<void> {
    state.dataset.fuzzyIndexSnapshot = null;
    if (state.dataset.fuzzyIndexStore) {
      await state.dataset.fuzzyIndexStore.clear();
    }
  },
  async persistTags(): Promise<void> {
    await persistTaggingNow();
  }
};

expose(api);
