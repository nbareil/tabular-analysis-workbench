import { createWithEqualityFn } from 'zustand/traditional';

import type {
  LabelDefinition,
  TagExportSource,
  TagRecord,
  TagRowsRequest,
  TaggingSnapshot
} from '@workers/types';
import { getDataWorker, type ExportTagsResponse, type TagRowsResponse } from '@workers/dataWorkerProxy';
import { useDataStore } from './dataStore';
import { useUndoStore } from './undoStore';

type TagStatus = 'idle' | 'loading' | 'ready' | 'error';

type PartialLabelInput = Partial<Omit<LabelDefinition, 'updatedAt'>> & {
  name: string;
};

interface TagState {
  labels: LabelDefinition[];
  tags: Record<number, TagRecord>;
  status: TagStatus;
  error: string | null;
  load: () => Promise<void>;
  applyTag: (request: TagRowsRequest) => Promise<TagRowsResponse | null>;
  clearTag: (rowIds: number[]) => Promise<TagRowsResponse | null>;
  /** Sets rows' records verbatim without recording an undo step (used by undo/redo). */
  restoreTags: (records: Record<number, TagRecord | null>) => Promise<void>;
  upsertLabel: (input: PartialLabelInput) => Promise<LabelDefinition | null>;
  deleteLabel: (labelId: string) => Promise<boolean>;
  exportTags: () => Promise<ExportTagsResponse | null>;
  /** Rejects with the worker's reason, e.g. when the export belongs to another file. */
  importTags: (
    snapshot: TaggingSnapshot,
    mergeStrategy: 'replace' | 'merge',
    source?: TagExportSource
  ) => Promise<TaggingSnapshot>;
  reset: () => void;
}

const mergeUpdated = (
  tags: Record<number, TagRecord>,
  updated: Record<number, TagRecord>
): Record<number, TagRecord> => {
  const next = { ...tags };
  for (const [rowKey, record] of Object.entries(updated)) {
    const rowId = Number(rowKey);
    if (record.labelIds.length === 0 && !record.note) {
      delete next[rowId];
    } else {
      next[rowId] = record;
    }
  }
  return next;
};

/**
 * Mirrors the worker's labels and notes for the open file. Every worker call runs through `run`,
 * which drops the response if another file was opened while the request was in flight.
 */
export const useTagStore = createWithEqualityFn<TagState>()((set) => {
  /** Resolves to the worker's value, or `fallback` when it failed or belongs to a previous file. */
  const run = async <T>(
    request: () => Promise<T>,
    apply: (value: T, state: TagState) => Partial<TagState>,
    fallback: T
  ): Promise<T> => {
    const loadId = useDataStore.getState().loadId;
    const current = () => useDataStore.getState().loadId === loadId;
    try {
      const value = await request();
      if (!current()) {
        return fallback;
      }
      set((state) => ({ ...apply(value, state), status: 'ready', error: null }));
      return value;
    } catch (error) {
      if (current()) {
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
      return fallback;
    }
  };

  /** Runs a tag mutation and records the rows' previous records so it can be undone. */
  const undoable = async (
    rowIds: number[],
    request: () => Promise<TagRowsResponse>
  ): Promise<TagRowsResponse | null> => {
    const previous = useTagStore.getState().tags;
    const before = Object.fromEntries(rowIds.map((rowId) => [rowId, previous[rowId] ?? null]));
    const response = await run<TagRowsResponse | null>(
      request,
      (result, state) => ({ tags: mergeUpdated(state.tags, result!.updated) }),
      null
    );
    if (response) {
      const after = Object.fromEntries(
        Object.entries(response.updated).map(([rowId, record]) => [
          rowId,
          record.labelIds.length || record.note ? record : null
        ])
      );
      useUndoStore.getState().record({ kind: 'tags', before, after });
    }
    return response;
  };

  return {
    labels: [],
    tags: {},
    status: 'idle',
    error: null,
    async load() {
      set({ status: 'loading', error: null });
      await run<TaggingSnapshot | null>(
        () => getDataWorker().loadTags(),
        (snapshot) => ({ labels: snapshot!.labels, tags: snapshot!.tags }),
        null
      );
    },
    applyTag: (request) => undoable(request.rowIds, () => getDataWorker().tagRows(request)),
    clearTag: (rowIds) => undoable(rowIds, () => getDataWorker().clearTag(rowIds)),
    async restoreTags(records) {
      await run<TagRowsResponse | null>(
        () => getDataWorker().restoreTags(records),
        (response, state) => ({ tags: mergeUpdated(state.tags, response!.updated) }),
        null
      );
    },
    upsertLabel: (input) =>
      run<LabelDefinition | null>(
        () =>
          getDataWorker().updateLabel({
            label: {
              id: input.id ?? crypto.randomUUID(),
              name: input.name,
              color: input.color ?? '#8899ff',
              description: input.description,
              createdAt: input.createdAt ?? Date.now(),
              updatedAt: Date.now()
            }
          }),
        (label, state) => ({
          labels: state.labels.some((entry) => entry.id === label!.id)
            ? state.labels.map((entry) => (entry.id === label!.id ? label! : entry))
            : [...state.labels, label!]
        }),
        null
      ),
    deleteLabel: async (labelId) => {
      const response = await run(
        () => getDataWorker().deleteLabel({ labelId }),
        (result, state) => ({
          labels: result.deleted ? state.labels.filter((label) => label.id !== labelId) : state.labels,
          tags: mergeUpdated(state.tags, result.updated)
        }),
        { deleted: false, updated: {} }
      );
      return response.deleted;
    },
    exportTags: () => run<ExportTagsResponse | null>(() => getDataWorker().exportTags(), () => ({}), null),
    async importTags(snapshot, mergeStrategy, source) {
      const loadId = useDataStore.getState().loadId;
      const response = await getDataWorker().importTags({
        labels: snapshot.labels,
        tags: snapshot.tags,
        mergeStrategy,
        source
      });
      if (useDataStore.getState().loadId === loadId) {
        set({ labels: response.labels, tags: response.tags, status: 'ready', error: null });
      }
      return response;
    },
    reset() {
      set({ labels: [], tags: {}, status: 'idle', error: null });
    }
  };
});
