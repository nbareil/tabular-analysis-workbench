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
import { normaliseLabelIds } from '../taggingHelpers';

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
  loadTags(): Promise<TaggingSnapshot>;
  tagRows(request: TagRowsRequest): Promise<TagRowsResponse>;
  clearTag(rowIds: number[]): Promise<TagRowsResponse>;
  restoreTags(records: Record<number, TagRecord | null>): Promise<TagRowsResponse>;
  updateLabel(request: UpdateLabelRequest): Promise<LabelDefinition>;
  deleteLabel(request: DeleteLabelRequest): Promise<DeleteLabelResponse>;
  exportTags(): Promise<ExportTagsResponse>;
  importTags(request: ImportTagsRequest): Promise<TaggingSnapshot>;
  persistTags(): Promise<void>;
}

export const createTaggingController = (
  state: DataWorkerStateController
): TaggingController => {
  const loadTags = async (): Promise<TaggingSnapshot> => ({
    labels: state.tagging.labels,
    tags: state.tagging.tags
  });

  const tagRows = async ({
    rowIds,
    labelIds,
    note,
    mode = 'replace'
  }: TagRowsRequest): Promise<TagRowsResponse> => {
    const timestamp = Date.now();
    const validLabelIds = new Set(state.tagging.labels.map((entry) => entry.id));
    const resolvedLabelIds =
      labelIds === undefined
        ? undefined
        : labelIds === null
          ? []
          : normaliseLabelIds(labelIds).filter((id) => validLabelIds.has(id));
    const updated: TagRowsResponse['updated'] = {};
    let mutated = false;

    const tagging = state.tagging;
    for (const rowId of rowIds) {
      if (!Number.isFinite(rowId) || rowId < 0) {
        continue;
      }

      const existing = tagging.tags[rowId];
      const record = buildTagRecord({
        existing,
        labelIds: resolvedLabelIds,
        note,
        mode,
        timestamp
      });
      record.labelIds = record.labelIds.filter((id) => validLabelIds.has(id));

      if (isTagRecordEmpty(record)) {
        if (existing) {
          delete tagging.tags[rowId];
          mutated = true;
        }
      } else {
        const changed =
          !existing ||
          existing.note !== record.note ||
          existing.labelIds.length !== record.labelIds.length ||
          existing.labelIds.some((id, index) => id !== record.labelIds[index]);
        tagging.tags[rowId] = record;
        mutated = mutated || changed;
      }

      updated[rowId] = record;
    }

    if (mutated) {
      state.markTaggingDirty();
    }

    return { updated };
  };

  const clearTag = async (rowIds: number[]): Promise<TagRowsResponse> => {
    const timestamp = Date.now();
    const updated: TagRowsResponse['updated'] = {};
    let mutated = false;

    const tagging = state.tagging;
    for (const rowId of rowIds) {
      if (!Number.isFinite(rowId) || rowId < 0) {
        continue;
      }

      if (tagging.tags[rowId]) {
        delete tagging.tags[rowId];
        mutated = true;
      }

      updated[rowId] = {
        labelIds: [],
        updatedAt: timestamp
      };
    }

    if (mutated) {
      state.markTaggingDirty();
    }

    return { updated };
  };

  const restoreTags = async (records: Record<number, TagRecord | null>): Promise<TagRowsResponse> => {
    const updated: TagRowsResponse['updated'] = {};
    const timestamp = Date.now();
    for (const [rowKey, record] of Object.entries(records)) {
      const rowId = Number(rowKey);
      if (record && !isTagRecordEmpty(record)) {
        state.tagging.tags[rowId] = { ...record, labelIds: [...record.labelIds] };
        updated[rowId] = state.tagging.tags[rowId]!;
      } else {
        delete state.tagging.tags[rowId];
        updated[rowId] = { labelIds: [], updatedAt: timestamp };
      }
    }
    state.markTaggingDirty();
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

    const tagging = state.tagging;
    const existingIndex = tagging.labels.findIndex((entry) => entry.id === label.id);
    if (existingIndex >= 0) {
      tagging.labels[existingIndex] = nextLabel;
    } else {
      tagging.labels.push(nextLabel);
    }

    state.markTaggingDirty();

    return nextLabel;
  };

  const deleteLabel = async ({ labelId }: DeleteLabelRequest): Promise<DeleteLabelResponse> => {
    const timestamp = Date.now();
    const updated: Record<number, TagRecord> = {};
    let deleted = false;

    const tagging = state.tagging;
    const before = tagging.labels.length;
    tagging.labels = tagging.labels.filter((label) => label.id !== labelId);
    deleted = tagging.labels.length < before;

    for (const [rowId, record] of Object.entries(tagging.tags)) {
      const numericRowId = Number(rowId);
      if (!Number.isFinite(numericRowId) || numericRowId < 0) {
        continue;
      }

      if (!record.labelIds.includes(labelId)) {
        continue;
      }

      const nextRecord = cascadeLabelDeletion(record, labelId, timestamp);
      if (isTagRecordEmpty(nextRecord)) {
        delete tagging.tags[numericRowId];
      } else {
        tagging.tags[numericRowId] = nextRecord;
      }
      updated[numericRowId] = nextRecord;
    }

    if (deleted || Object.keys(updated).length > 0) {
      state.markTaggingDirty();
    }

    return { deleted, updated };
  };

  const exportTags = async (): Promise<ExportTagsResponse> => {
    const exportedAt = Date.now();
    const fileName = state.dataset.fileName;
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
    mergeStrategy = 'merge',
    source
  }: ImportTagsRequest): Promise<TaggingSnapshot> => {
    const totalRows = state.dataset.totalRows;
    if (source?.rowCount != null && source.rowCount !== totalRows) {
      throw new Error(
        `These annotations were exported from a file with ${source.rowCount.toLocaleString()} rows, ` +
          `but the open file has ${totalRows.toLocaleString()}. Row numbers would not line up.`
      );
    }

    const timestamp = Date.now();
    const labelMap = new Map<string, LabelDefinition>();
    if (mergeStrategy === 'merge') {
      for (const label of state.tagging.labels) {
        labelMap.set(label.id, label);
      }
    }
    for (const label of labels) {
      const imported = normaliseImportedLabel(label, timestamp);
      labelMap.set(imported.id, imported);
    }

    const nextTags: Record<number, TagRecord> = mergeStrategy === 'merge' ? { ...state.tagging.tags } : {};
    for (const [rowKey, record] of Object.entries(tags ?? {})) {
      const rowId = Number(rowKey);
      if (!Number.isInteger(rowId) || rowId < 0 || rowId >= totalRows) {
        continue;
      }
      const nextRecord = buildTagRecord({
        existing: nextTags[rowId],
        labelIds: normaliseLabelIds(record.labelIds).filter((id) => labelMap.has(id)),
        note: typeof record.note === 'string' && record.note.length > 0 ? record.note : undefined,
        mode: 'append',
        timestamp: Number.isFinite(record.updatedAt) ? record.updatedAt : timestamp
      });
      if (!isTagRecordEmpty(nextRecord)) {
        nextTags[rowId] = nextRecord;
      }
    }

    state.tagging.labels = Array.from(labelMap.values());
    state.tagging.tags = nextTags;
    state.markTaggingDirty();

    return { labels: state.tagging.labels, tags: state.tagging.tags };
  };

  const persistTags = async (): Promise<void> => {
    await state.persistTaggingNow();
  };

  return {
    loadTags,
    tagRows,
    clearTag,
    restoreTags,
    updateLabel,
    deleteLabel,
    exportTags,
    importTags,
    persistTags
  };
};
