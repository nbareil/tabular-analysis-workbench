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

  const { labelId, note, color, updatedAt } = value as Partial<TagRecord>;
  const labelValid = labelId === null || typeof labelId === 'string';
  const noteValid = note === undefined || typeof note === 'string';
  const colorValid = color === undefined || typeof color === 'string';
  const timestampValid = typeof updatedAt === 'number' && Number.isFinite(updatedAt);

  return labelValid && noteValid && colorValid && timestampValid;
};

const isTaggingSnapshot = (value: unknown): value is TaggingSnapshot => {
  if (!isPlainObject(value)) {
    return false;
  }

  const labels = (value as TaggingSnapshot).labels;
  const tags = (value as TaggingSnapshot).tags;

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

export const parseTagExport = (input: unknown): ParsedTagExport => {
  if (isTaggingSnapshot(input)) {
    return {
      snapshot: input,
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
      snapshot: envelope.payload,
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
