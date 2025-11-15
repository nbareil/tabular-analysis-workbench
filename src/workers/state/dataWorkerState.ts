import { TaggingStore } from '../taggingStore';
import type { FuzzyIndexStore, FuzzyIndexFingerprint, FuzzyIndexSnapshot } from '../fuzzyIndexStore';
import type {
  ColumnInference,
  ColumnType,
  FilterNode,
  LabelDefinition,
  SortDefinition,
  TagRecord
} from '../types';
import type { RowBatchStore } from '../rowBatchStore';

const DEFAULT_OPTIONS = {
  enableDuckDb: false,
  chunkSize: 1_048_576,
  debugLogging: false,
  slowBatchThresholdMs: 32
} as const;

const TAG_PERSIST_DEBOUNCE_MS = 30_000;

export interface WorkerOptionsState {
  enableDuckDb: boolean;
  chunkSize: number;
  debugLogging: boolean;
  slowBatchThresholdMs: number;
}

export interface DatasetState {
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
}

export interface TaggingState {
  labels: LabelDefinition[];
  tags: Record<number, TagRecord>;
  store: TaggingStore | null;
  dirty: boolean;
  persistTimer: number | null;
}

export interface DataWorkerStateController {
  readonly options: Readonly<WorkerOptionsState>;
  readonly dataset: Readonly<DatasetState>;
  readonly tagging: Readonly<TaggingState>;
  setOptions(options: Partial<WorkerOptionsState>): void;
  prepareDatasetForLoad(params: {
    batchStore: RowBatchStore;
    datasetKey: string;
    fileHandle: FileSystemFileHandle | null;
  }): void;
  updateDataset(mutator: (dataset: DatasetState) => void): void;
  resetDataset(): void;
  resetTagging(): void;
  updateTagging<T = void>(mutator: (tagging: TaggingState) => T): T;
  clearTaggingPersistTimer(): void;
  hydrateTaggingStore(fingerprint: FuzzyIndexFingerprint | null): Promise<void>;
  markTaggingDirty(): void;
  persistTaggingNow(): Promise<void>;
}

const createEmptyDatasetState = (): DatasetState => ({
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
});

const createEmptyTaggingState = (): TaggingState => ({
  labels: [],
  tags: {},
  store: null,
  dirty: false,
  persistTimer: null
});

class DataWorkerState implements DataWorkerStateController {
  private _options: WorkerOptionsState = { ...DEFAULT_OPTIONS };
  private _dataset: DatasetState = createEmptyDatasetState();
  private _tagging: TaggingState = createEmptyTaggingState();

  get options(): Readonly<WorkerOptionsState> {
    return this._options;
  }

  get dataset(): Readonly<DatasetState> {
    return this._dataset;
  }

  get tagging(): Readonly<TaggingState> {
    return this._tagging;
  }

  setOptions(options: Partial<WorkerOptionsState>): void {
    this._options = {
      enableDuckDb:
        typeof options.enableDuckDb === 'boolean'
          ? options.enableDuckDb
          : this._options.enableDuckDb,
      chunkSize:
        typeof options.chunkSize === 'number' && Number.isFinite(options.chunkSize)
          ? options.chunkSize
          : this._options.chunkSize,
      debugLogging:
        typeof options.debugLogging === 'boolean'
          ? options.debugLogging
          : this._options.debugLogging,
      slowBatchThresholdMs:
        typeof options.slowBatchThresholdMs === 'number' &&
        Number.isFinite(options.slowBatchThresholdMs) &&
        options.slowBatchThresholdMs >= 0
          ? options.slowBatchThresholdMs
          : this._options.slowBatchThresholdMs
    };
  }

  prepareDatasetForLoad(params: {
    batchStore: RowBatchStore;
    datasetKey: string;
    fileHandle: FileSystemFileHandle | null;
  }): void {
    this._dataset = {
      ...createEmptyDatasetState(),
      batchStore: params.batchStore,
      datasetKey: params.datasetKey,
      fileHandle: params.fileHandle,
      sortComplete: true
    };
  }

  updateDataset(mutator: (dataset: DatasetState) => void): void {
    mutator(this._dataset);
  }

  resetDataset(): void {
    this._dataset = createEmptyDatasetState();
  }

  resetTagging(): void {
    this.clearTaggingPersistTimer();
    this._tagging = createEmptyTaggingState();
  }

  updateTagging<T = void>(mutator: (tagging: TaggingState) => T): T {
    return mutator(this._tagging);
  }

  clearTaggingPersistTimer(): void {
    if (this._tagging.persistTimer != null) {
      clearTimeout(this._tagging.persistTimer);
      this._tagging.persistTimer = null;
    }
  }

  async hydrateTaggingStore(fingerprint: FuzzyIndexFingerprint | null): Promise<void> {
    this.clearTaggingPersistTimer();

    if (!fingerprint) {
      this._tagging = createEmptyTaggingState();
      return;
    }

    try {
      const store = await TaggingStore.create(fingerprint);
      this._tagging.store = store;
      const snapshot = await store.load();
      this._tagging.labels = snapshot?.labels ?? [];
      this._tagging.tags = snapshot?.tags ?? {};
      this._tagging.dirty = false;
    } catch (error) {
      console.warn('[data-worker][tagging] Failed to hydrate tagging store', error);
      this._tagging = createEmptyTaggingState();
    }
  }

  markTaggingDirty(): void {
    this._tagging.dirty = true;
    this.scheduleTaggingPersist();
  }

  async persistTaggingNow(): Promise<void> {
    if (!this._tagging.store || !this._tagging.dirty) {
      return;
    }

    try {
      await this._tagging.store.save({
        labels: this._tagging.labels,
        tags: this._tagging.tags
      });
      this._tagging.dirty = false;
    } catch (error) {
      console.warn('[data-worker][tagging] Failed to persist snapshot', error);
    }
  }

  private scheduleTaggingPersist(): void {
    if (!this._tagging.store) {
      return;
    }

    this.clearTaggingPersistTimer();
    this._tagging.persistTimer = setTimeout(() => {
      void this.persistTaggingNow();
    }, TAG_PERSIST_DEBOUNCE_MS) as unknown as number;
  }
}

export const createDataWorkerState = (): DataWorkerStateController => new DataWorkerState();
