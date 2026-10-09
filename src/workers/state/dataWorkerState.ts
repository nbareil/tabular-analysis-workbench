import { TaggingStore } from '../taggingStore';
import type { DatasetFingerprint } from '../datasetFingerprint';
import type {
  ColumnInference,
  ColumnType,
  FilterNode,
  LabelDefinition,
  SortDefinition,
  TagRecord
} from '../types';
import type { RowBatchStore } from '../rowBatchStore';
import type { ColumnValueDistributionResult } from '../workerApiTypes';
import { normaliseLabelIds } from '../taggingHelpers';
import { createDefaultMitreAttackTacticLabels } from '@constants/mitreAttackTactics';

const DEFAULT_OPTIONS = {
  debugLogging: false,
  slowBatchThresholdMs: 32
} as const;

// Short, so closing the tab right after an edit loses at most a fraction of a second of work:
// the worker is killed on unload before an async OPFS write started then can commit.
const TAG_PERSIST_DEBOUNCE_MS = 300;
const TAG_PERSIST_RETRY_MS = 5_000;

export class StaleOperationError extends Error {
  override name = 'StaleOperationError';
  constructor() {
    super('Superseded by a newer request');
  }
}

export interface WorkerOptionsState {
  debugLogging: boolean;
  slowBatchThresholdMs: number;
}

export interface SearchSpec {
  query: string;
  columns: string[];
  caseSensitive: boolean;
}

/**
 * Everything known about the loaded file. A new object is created for every load, so holding a
 * reference doubles as a token: work that started on an older dataset can detect it was replaced.
 *
 * The view is a pipeline: all rows → filter → search → sort. Each stage is null when inactive and
 * the active row order is the last non-null stage.
 */
export interface DatasetState {
  batchStore: RowBatchStore | null;
  fileName: string | null;
  header: string[];
  columnTypes: Record<string, ColumnType>;
  columnInference: Record<string, ColumnInference>;
  totalRows: number;
  bytesParsed: number;
  malformedRows: number;
  loading: boolean;
  filterExpression: FilterNode | null;
  filterRowIds: Uint32Array | null;
  search: SearchSpec | null;
  searchRowIds: Uint32Array | null;
  sorts: SortDefinition[];
  sortedRowIds: Uint32Array | null;
  valueDistributions: Map<string, Promise<ColumnValueDistributionResult>>;
}

export interface TaggingState {
  labels: LabelDefinition[];
  tags: Record<number, TagRecord>;
  store: TaggingStore | null;
  dirty: boolean;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Pipeline stages, in order; starting an operation invalidates in-flight work on its stage and later ones.
 * Grouping reads the filtered/searched rows, so it comes last.
 */
export type ViewStage = 'filter' | 'search' | 'sort' | 'group';
const STAGES: ViewStage[] = ['filter', 'search', 'sort', 'group'];

export interface DataWorkerStateController {
  readonly options: Readonly<WorkerOptionsState>;
  readonly dataset: DatasetState;
  readonly tagging: TaggingState;
  setOptions(options: Partial<WorkerOptionsState>): void;
  startDataset(params: { batchStore: RowBatchStore; fileName: string }): DatasetState;
  resetDataset(): void;
  /**
   * Runs view operations one at a time in request order. `check` throws StaleOperationError once a
   * newer request for the same or an earlier stage arrives, or the dataset is replaced.
   */
  runViewOperation<T>(stage: ViewStage, operation: (check: () => void) => Promise<T>): Promise<T>;
  hydrateTagging(fingerprint: DatasetFingerprint, dataset: DatasetState): Promise<void>;
  resetTagging(): void;
  markTaggingDirty(): void;
  persistTaggingNow(): Promise<void>;
}

const createEmptyDataset = (): DatasetState => ({
  batchStore: null,
  fileName: null,
  header: [],
  columnTypes: {},
  columnInference: {},
  totalRows: 0,
  bytesParsed: 0,
  malformedRows: 0,
  loading: false,
  filterExpression: null,
  filterRowIds: null,
  search: null,
  searchRowIds: null,
  sorts: [],
  sortedRowIds: null,
  valueDistributions: new Map()
});

const createEmptyTagging = (): TaggingState => ({
  labels: [],
  tags: {},
  store: null,
  dirty: false,
  persistTimer: null
});

const canonicaliseTags = (
  incoming: Record<string, TagRecord> | undefined,
  labels: LabelDefinition[]
): Record<number, TagRecord> => {
  const allowed = new Set(labels.map((label) => label.id));
  const tags: Record<number, TagRecord> = {};
  for (const [rowKey, record] of Object.entries(incoming ?? {})) {
    const rowId = Number(rowKey);
    if (!Number.isInteger(rowId) || rowId < 0 || !record) {
      continue;
    }
    const canonical: TagRecord = {
      labelIds: normaliseLabelIds(record.labelIds).filter((id) => allowed.has(id)),
      updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now()
    };
    if (typeof record.note === 'string' && record.note.length > 0) {
      canonical.note = record.note;
    }
    if (canonical.labelIds.length > 0 || canonical.note) {
      tags[rowId] = canonical;
    }
  }
  return tags;
};

class DataWorkerState implements DataWorkerStateController {
  options: WorkerOptionsState = { ...DEFAULT_OPTIONS };
  dataset: DatasetState = createEmptyDataset();
  tagging: TaggingState = createEmptyTagging();
  private generations: Record<ViewStage, number> = { filter: 0, search: 0, sort: 0, group: 0 };
  private queue: Promise<unknown> = Promise.resolve();

  setOptions(options: Partial<WorkerOptionsState>): void {
    this.options = {
      debugLogging: options.debugLogging ?? this.options.debugLogging,
      slowBatchThresholdMs:
        options.slowBatchThresholdMs != null && options.slowBatchThresholdMs >= 0
          ? options.slowBatchThresholdMs
          : this.options.slowBatchThresholdMs
    };
  }

  startDataset({ batchStore, fileName }: { batchStore: RowBatchStore; fileName: string }): DatasetState {
    this.dataset = { ...createEmptyDataset(), batchStore, fileName, loading: true };
    return this.dataset;
  }

  resetDataset(): void {
    this.dataset = createEmptyDataset();
  }

  runViewOperation<T>(stage: ViewStage, operation: (check: () => void) => Promise<T>): Promise<T> {
    for (const later of STAGES.slice(STAGES.indexOf(stage))) {
      this.generations[later] += 1;
    }
    // A request at stage T bumps T and every later stage, so this operation is superseded exactly when
    // its own stage counter moves: a newer request at the same or an earlier stage.
    const generation = this.generations[stage];
    const dataset = this.dataset;
    const check = (): void => {
      if (dataset !== this.dataset || this.generations[stage] !== generation) {
        throw new StaleOperationError();
      }
    };
    const run = this.queue.then(() => {
      check();
      return operation(check);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async hydrateTagging(fingerprint: DatasetFingerprint, dataset: DatasetState): Promise<void> {
    const store = await TaggingStore.create(fingerprint);
    const snapshot = await store.load();
    if (dataset !== this.dataset) {
      return;
    }
    const labels = snapshot?.labels ?? createDefaultMitreAttackTacticLabels();
    this.tagging = {
      ...createEmptyTagging(),
      store,
      labels,
      tags: canonicaliseTags(snapshot?.tags, labels)
    };
  }

  resetTagging(): void {
    if (this.tagging.persistTimer != null) {
      clearTimeout(this.tagging.persistTimer);
    }
    this.tagging = createEmptyTagging();
  }

  markTaggingDirty(): void {
    this.tagging.dirty = true;
    this.schedulePersist();
  }

  persistTaggingNow(): Promise<void> {
    if (this.tagging.persistTimer != null) {
      clearTimeout(this.tagging.persistTimer);
      this.tagging.persistTimer = null;
    }
    // One save at a time: each starts from the state current when it runs, so the last write wins.
    this.saveQueue = this.saveQueue.then(() => this.saveTagging());
    return this.saveQueue;
  }

  private saveQueue: Promise<void> = Promise.resolve();

  private async saveTagging(): Promise<void> {
    const tagging = this.tagging;
    if (!tagging.store || !tagging.dirty) {
      return;
    }
    tagging.dirty = false;
    try {
      await tagging.store.save({ labels: tagging.labels, tags: tagging.tags });
    } catch (error) {
      console.warn('[data-worker][tagging] Failed to persist labels; will retry', error);
      if (tagging === this.tagging) {
        tagging.dirty = true;
        this.schedulePersist(TAG_PERSIST_RETRY_MS);
      }
    }
  }

  private schedulePersist(delay = TAG_PERSIST_DEBOUNCE_MS): void {
    if (!this.tagging.store || this.tagging.persistTimer != null) {
      return;
    }
    this.tagging.persistTimer = setTimeout(() => {
      this.tagging.persistTimer = null;
      void this.persistTaggingNow();
    }, delay);
  }
}

export const createDataWorkerState = (): DataWorkerStateController => new DataWorkerState();
