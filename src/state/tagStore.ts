import { create } from 'zustand';

import type {
  LabelDefinition,
  TagRecord,
  TagRowsRequest,
  TaggingSnapshot
} from '@workers/types';
import {
  getDataWorker,
  type TagRowsResponse,
  type ExportTagsResponse
} from '@workers/dataWorkerProxy';

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
  upsertLabel: (input: PartialLabelInput) => Promise<LabelDefinition | null>;
  deleteLabel: (labelId: string) => Promise<boolean>;
  exportTags: () => Promise<ExportTagsResponse | null>;
  importTags: (snapshot: TaggingSnapshot, mergeStrategy?: 'replace' | 'merge') => Promise<void>;
  reset: () => void;
}

const generateId = (): string => crypto.randomUUID();

export const useTagStore = create<TagState>((set, get) => ({
  labels: [],
  tags: {},
  status: 'idle',
  error: null,
  async load() {
    set({ status: 'loading', error: null });
    try {
      const worker = getDataWorker();
      const snapshot = await worker.loadTags();
      set({
        labels: snapshot.labels,
        tags: snapshot.tags,
        status: 'ready'
      });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  },
  async applyTag(request) {
    try {
      const worker = getDataWorker();
      const response = await worker.tagRows(request);
      set((state) => {
        const nextTags: Record<number, TagRecord> = { ...state.tags };
        for (const [rowId, record] of Object.entries(response.updated)) {
          const numericRowId = Number(rowId);
          if (!Number.isFinite(numericRowId)) {
            continue;
          }

          if (record.labelId == null && !record.note) {
            delete nextTags[numericRowId];
          } else {
            nextTags[numericRowId] = record;
          }
        }

        return {
          tags: nextTags,
          status: 'ready'
        };
      });
      return response;
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  },
  async clearTag(rowIds) {
    try {
      const worker = getDataWorker();
      const response = await worker.clearTag(rowIds);
      set((state) => {
        const nextTags = { ...state.tags };
        for (const rowId of rowIds) {
          delete nextTags[rowId];
        }
        return {
          tags: nextTags,
          status: 'ready'
        };
      });
      return response;
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  },
  async upsertLabel(input) {
    try {
      const worker = getDataWorker();
      const label: LabelDefinition = {
        id: input.id ?? generateId(),
        name: input.name,
        color: input.color ?? '#8899ff',
        description: input.description,
        createdAt: input.createdAt ?? Date.now(),
        updatedAt: Date.now()
      };
      const response = await worker.updateLabel({ label });
      set((state) => {
        const existingIndex = state.labels.findIndex((entry) => entry.id === response.id);
        const labels = [...state.labels];
        if (existingIndex >= 0) {
          labels[existingIndex] = response;
        } else {
          labels.push(response);
        }
        return {
          labels,
          status: 'ready'
        };
      });
      return response;
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  },
  async deleteLabel(labelId) {
    try {
      const worker = getDataWorker();
      const response = await worker.deleteLabel({ labelId });
      set((state) => {
        const nextLabels = response.deleted
          ? state.labels.filter((label) => label.id !== labelId)
          : state.labels;
        const nextTags = { ...state.tags };

        for (const [rowId, record] of Object.entries(response.updated)) {
          const numericRowId = Number(rowId);
          if (!Number.isFinite(numericRowId)) {
            continue;
          }

          if (record.labelId == null && !record.note) {
            delete nextTags[numericRowId];
          } else {
            nextTags[numericRowId] = record;
          }
        }

        return {
          labels: nextLabels,
          tags: nextTags,
          status: 'ready'
        };
      });
      return response.deleted;
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  },
  async exportTags() {
    try {
      const worker = getDataWorker();
      const response = await worker.exportTags();
      return response;
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  },
  async importTags(snapshot, mergeStrategy = 'merge') {
    try {
      const worker = getDataWorker();
      const response = await worker.importTags({
        labels: snapshot.labels,
        tags: snapshot.tags,
        mergeStrategy
      });
      set({
        labels: response.labels,
        tags: response.tags,
        status: 'ready',
        error: null
      });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  },
  reset() {
    set({ labels: [], tags: {}, status: 'idle', error: null });
  }
}));
