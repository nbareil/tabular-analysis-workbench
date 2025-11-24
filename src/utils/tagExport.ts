import {
  TAG_EXPORT_VERSION,
  type ExportTagsResponse,
  type LabelDefinition,
  type TagExportSource,
  type TagRecord,
  type TaggingSnapshot
} from '@workers/types';

export interface ParsedTagExport {
  snapshot: TaggingSnapshot;
  metadata: {
    version?: number;
    exportedAt?: number;
    source?: TagExportSource;
  } | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isLabelDefinition = (value: unknown): value is LabelDefinition => {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.color === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  );
};

const isTagRecord = (value: unknown): value is TagRecord => {
  if (!isPlainObject(value)) {
    return false;
  }

  const { labelIds, note, updatedAt } = value as Partial<TagRecord>;
  const legacyLabelId = (value as any).labelId;
  const labelValid =
    (Array.isArray(labelIds) && labelIds.every((id) => typeof id === 'string')) ||
    legacyLabelId === null ||
    typeof legacyLabelId === 'string';
  const noteValid = note === undefined || typeof note === 'string';
  const timestampValid = typeof updatedAt === 'number' && Number.isFinite(updatedAt);

  return labelValid && noteValid && timestampValid;
};

const isTaggingSnapshot = (value: unknown): value is TaggingSnapshot => {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as { labels?: unknown; tags?: unknown };
  const labels = candidate.labels;
  const tags = candidate.tags;

  if (!Array.isArray(labels) || !labels.every(isLabelDefinition)) {
    return false;
  }

  if (typeof tags !== 'object' || tags === null) {
    return false;
  }

  return Object.values(tags).every((entry) => entry === undefined || isTagRecord(entry));
};

const normaliseFileStem = (fileName?: string | null): string => {
  if (!fileName) {
    return 'annotations';
  }

  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  const slug = withoutExtension
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'annotations';
};

const formatTimestampForFilename = (timestamp?: number): string => {
  const date = typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp)
    : new Date();
  return date.toISOString().replace(/[:.]/g, '-');
};

export const buildTagExportFilename = (
  sourceFileName?: string | null,
  exportedAt?: number
): string => {
  const stem = normaliseFileStem(sourceFileName);
  const formattedTimestamp = formatTimestampForFilename(exportedAt);
  return `${stem}-annotations-${formattedTimestamp}.json`;
};

const normaliseLabelIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed) {
      unique.add(trimmed);
    }
  }

  return Array.from(unique.values());
};

const toTagRecord = (value: any): TagRecord => {
  const labelIds =
    Array.isArray(value?.labelIds) && value.labelIds.length > 0
      ? normaliseLabelIds(value.labelIds)
      : value?.labelId
        ? normaliseLabelIds([value.labelId])
        : [];

  const record: TagRecord = {
    labelIds,
    updatedAt:
      typeof value?.updatedAt === 'number' && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : Date.now()
  };

  if (typeof value?.note === 'string') {
    record.note = value.note;
  }

  return record;
};

const toTaggingSnapshot = (value: TaggingSnapshot): TaggingSnapshot => {
  const tags: Record<number, TagRecord> = {};
  for (const [rowKey, record] of Object.entries(value.tags)) {
    const rowId = Number(rowKey);
    if (!Number.isFinite(rowId) || rowId < 0 || !record) {
      continue;
    }
    tags[rowId] = toTagRecord(record);
  }

  return {
    labels: value.labels,
    tags
  };
};

export const parseTagExport = (input: unknown): ParsedTagExport => {
  if (isTaggingSnapshot(input)) {
    return {
      snapshot: toTaggingSnapshot(input),
      metadata: null
    };
  }

  if (isPlainObject(input) && 'payload' in input) {
    const envelope = input as Partial<ExportTagsResponse>;
    if (envelope.version !== TAG_EXPORT_VERSION) {
      throw new Error('Unsupported annotations export version.');
    }
    if (!isTaggingSnapshot(envelope.payload)) {
      throw new Error('Annotations export payload is invalid.');
    }

    return {
      snapshot: toTaggingSnapshot(envelope.payload),
      metadata: {
        version: envelope.version,
        exportedAt:
          typeof envelope.exportedAt === 'number' && Number.isFinite(envelope.exportedAt)
            ? envelope.exportedAt
            : undefined,
        source: envelope.source
      }
    };
  }

  throw new Error('File is not a valid annotations export.');
};
