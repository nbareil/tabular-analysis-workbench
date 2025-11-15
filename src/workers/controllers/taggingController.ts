import { buildTagRecord, cascadeLabelDeletion, isTagRecordEmpty } from '../taggingHelpers';
import type { DataWorkerStateController } from '../state/dataWorkerState';
import type {
  TaggingSnapshot,
  TagRowsRequest,
  TagRowsResponse,
  UpdateLabelRequest,
  LabelDefinition,
  DeleteLabelRequest,
  DeleteLabelResponse,
  ExportTagsResponse,
  ImportTagsRequest,
  TagRecord
} from '../types';
import { TAG_EXPORT_VERSION } from '../types';

const DEFAULT_LABEL_COLOR = '#8899ff';

const generateRandomId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

export interface TaggingController {
  init(): void;
  clear(): void;
  loadTags(): Promise<TaggingSnapshot>;
  tagRows(request: TagRowsRequest): Promise<TagRowsResponse>;
  clearTag(rowIds: number[]): Promise<TagRowsResponse>;
  updateLabel(request: UpdateLabelRequest): Promise<LabelDefinition>;
  deleteLabel(request: DeleteLabelRequest): Promise<DeleteLabelResponse>;
  exportTags(): Promise<ExportTagsResponse>;
  importTags(request: ImportTagsRequest): Promise<TaggingSnapshot>;
  persistTags(): Promise<void>;
}

export const createTaggingController = (
  state: DataWorkerStateController
): TaggingController => {
  const init = (): void => {
    // No-op hook for lifecycle symmetry
  };

  const clear = (): void => {
    state.resetTagging();
  };

  const loadTags = async (): Promise<TaggingSnapshot> => ({
    labels: state.tagging.labels,
    tags: state.tagging.tags
  });

  const tagRows = async ({ rowIds, labelId, note }: TagRowsRequest): Promise<TagRowsResponse> => {
    const timestamp = Date.now();
    const resolvedLabelId = labelId ?? null;
    const label = resolvedLabelId
      ? state.tagging.labels.find((entry) => entry.id === resolvedLabelId)
      : undefined;
    const updated: TagRowsResponse['updated'] = {};
    let mutated = false;

    state.updateTagging((tagging) => {
      for (const rowId of rowIds) {
        if (!Number.isFinite(rowId) || rowId < 0) {
          continue;
        }

        const existing = tagging.tags[rowId];
        const record = buildTagRecord({
          existing,
          label,
          labelId: resolvedLabelId,
          note,
          timestamp
        });

        if (isTagRecordEmpty(record)) {
          if (existing) {
            delete tagging.tags[rowId];
            mutated = true;
          }
        } else {
          const changed =
            !existing ||
            existing.labelId !== record.labelId ||
            existing.note !== record.note ||
            existing.color !== record.color;
          tagging.tags[rowId] = record;
          mutated = mutated || changed;
        }

        updated[rowId] = record;
      }
    });

    if (mutated) {
      state.markTaggingDirty();
    }

    return { updated };
  };

  const clearTag = async (rowIds: number[]): Promise<TagRowsResponse> => {
    const timestamp = Date.now();
    const updated: TagRowsResponse['updated'] = {};
    let mutated = false;

    state.updateTagging((tagging) => {
      for (const rowId of rowIds) {
        if (!Number.isFinite(rowId) || rowId < 0) {
          continue;
        }

        if (tagging.tags[rowId]) {
          delete tagging.tags[rowId];
          mutated = true;
        }

        updated[rowId] = {
          labelId: null,
          updatedAt: timestamp
        };
      }
    });

    if (mutated) {
      state.markTaggingDirty();
    }

    return { updated };
  };

  const updateLabel = async ({ label }: UpdateLabelRequest): Promise<LabelDefinition> => {
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
    const nextLabel: LabelDefinition = {
      id: label.id,
      name: safeName,
      color: safeColor,
      description: safeDescription,
      createdAt: typeof label.createdAt === 'number' ? label.createdAt : timestamp,
      updatedAt: timestamp
    };

    state.updateTagging((tagging) => {
      const existingIndex = tagging.labels.findIndex((entry) => entry.id === label.id);
      if (existingIndex >= 0) {
        tagging.labels[existingIndex] = nextLabel;
      } else {
        tagging.labels.push(nextLabel);
      }

      for (const [key, record] of Object.entries(tagging.tags)) {
        if (record.labelId !== nextLabel.id) {
          continue;
        }

        const rowId = Number(key);
        if (!Number.isFinite(rowId) || rowId < 0) {
          continue;
        }

        tagging.tags[rowId] = {
          ...record,
          color: nextLabel.color,
          updatedAt: timestamp
        };
      }
    });

    state.markTaggingDirty();

    return nextLabel;
  };

  const deleteLabel = async ({ labelId }: DeleteLabelRequest): Promise<DeleteLabelResponse> => {
    const timestamp = Date.now();
    const updated: Record<number, TagRecord> = {};
    let deleted = false;

    state.updateTagging((tagging) => {
      const before = tagging.labels.length;
      tagging.labels = tagging.labels.filter((label) => label.id !== labelId);
      deleted = tagging.labels.length < before;

      for (const [rowId, record] of Object.entries(tagging.tags)) {
        if (record.labelId !== labelId) {
          continue;
        }

        const numericRowId = Number(rowId);
        if (!Number.isFinite(numericRowId) || numericRowId < 0) {
          continue;
        }

        const nextRecord = cascadeLabelDeletion(record, timestamp);
        if (isTagRecordEmpty(nextRecord)) {
          delete tagging.tags[numericRowId];
        } else {
          tagging.tags[numericRowId] = nextRecord;
        }
        updated[numericRowId] = nextRecord;
      }
    });

    if (deleted || Object.keys(updated).length > 0) {
      state.markTaggingDirty();
    }

    return { deleted, updated };
  };

  const exportTags = async (): Promise<ExportTagsResponse> => {
    const exportedAt = Date.now();
    const fileName = state.dataset.fileHandle?.name ?? null;
    const rowCount =
      typeof state.dataset.totalRows === 'number' && Number.isFinite(state.dataset.totalRows)
        ? Math.max(0, state.dataset.totalRows)
        : undefined;
    const source =
      fileName != null || typeof rowCount === 'number'
        ? {
            fileName,
            rowCount
          }
        : undefined;

    return {
      version: TAG_EXPORT_VERSION,
      exportedAt,
      source,
      payload: {
        labels: state.tagging.labels,
        tags: state.tagging.tags
      }
    };
  };

  const importTags = async ({
    labels,
    tags,
    mergeStrategy = 'merge'
  }: ImportTagsRequest): Promise<TaggingSnapshot> => {
    const timestamp = Date.now();
    const incomingLabels = Array.isArray(labels) ? labels : [];
    const normalisedIncoming = incomingLabels.map((entry) => normaliseImportedLabel(entry, timestamp));

    const labelMap: Map<string, LabelDefinition> = new Map();
    if (mergeStrategy === 'merge') {
      for (const label of state.tagging.labels) {
        labelMap.set(label.id, label);
      }
    }
    for (const label of normalisedIncoming) {
      labelMap.set(label.id, label);
    }

    const nextTags: Record<number, TagRecord> =
      mergeStrategy === 'merge' ? { ...state.tagging.tags } : {};
    const incomingTags = tags ?? {};

    let mutated = mergeStrategy === 'replace';

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
      const note = typeof record.note === 'string' ? record.note : undefined;
      const recordTimestamp =
        typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : timestamp;
      const existing = mergeStrategy === 'merge' ? nextTags[rowId] : undefined;
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

    state.updateTagging((tagging) => {
      tagging.labels = Array.from(labelMap.values());
      tagging.tags = nextTags;
    });

    if (mutated || normalisedIncoming.length > 0) {
      state.markTaggingDirty();
    }

    return {
      labels: state.tagging.labels,
      tags: state.tagging.tags
    };
  };

  const persistTags = async (): Promise<void> => {
    await state.persistTaggingNow();
  };

  return {
    init,
    clear,
    loadTags,
    tagRows,
    clearTag,
    updateLabel,
    deleteLabel,
    exportTags,
    importTags,
    persistTags
  };
};
