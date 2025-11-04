import type { LabelDefinition, TagRecord } from './types';

interface BuildTagRecordOptions {
  existing?: TagRecord;
  label?: LabelDefinition;
  labelId: string | null;
  note?: string;
  timestamp: number;
}

const hasText = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

/**
 * Builds a TagRecord that preserves existing notes when the caller omits them
 * and carries label colors forward for quick rendering.
 */
export const buildTagRecord = ({
  existing,
  label,
  labelId,
  note,
  timestamp
}: BuildTagRecordOptions): TagRecord => {
  const record: TagRecord = {
    labelId,
    updatedAt: timestamp
  };

  const nextNote = note === undefined ? existing?.note : note;
  if (hasText(nextNote)) {
    record.note = nextNote;
  }

  if (labelId && label?.color) {
    record.color = label.color;
  } else if (labelId && existing?.color) {
    record.color = existing.color;
  }

  return record;
};

/**
 * Cascades label deletion to a tag record while preserving user-authored notes.
 */
export const cascadeLabelDeletion = (
  record: TagRecord,
  timestamp: number
): TagRecord => {
  const next: TagRecord = {
    labelId: null,
    updatedAt: timestamp
  };

  if (hasText(record.note)) {
    next.note = record.note;
  }

  return next;
};

/**
 * Determines whether a tag record is effectively empty and can be removed when
 * labels and notes are cleared.
 */
export const isTagRecordEmpty = (record: TagRecord): boolean => {
  return record.labelId == null && !hasText(record.note);
};
