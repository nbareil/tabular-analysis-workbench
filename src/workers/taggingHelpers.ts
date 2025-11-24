import type { TagRecord } from './types';

const hasText = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

const uniqueLabelIds = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
};

export const normaliseLabelIds = (raw: string[] | null | undefined): string[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const cleaned = raw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  return uniqueLabelIds(cleaned);
};

export const buildTagRecord = ({
  existing,
  labelIds,
  note,
  mode,
  timestamp
}: {
  existing?: TagRecord;
  labelIds?: string[] | null;
  note?: string;
  mode?: 'replace' | 'append' | 'remove';
  timestamp: number;
}): TagRecord => {
  const existingLabelIds = normaliseLabelIds(existing?.labelIds ?? []);
  let nextLabelIds: string[];

  if (labelIds === undefined) {
    nextLabelIds = existingLabelIds;
  } else if (labelIds === null) {
    nextLabelIds = [];
  } else {
    const incoming = normaliseLabelIds(labelIds);
    switch (mode) {
      case 'append':
        nextLabelIds = uniqueLabelIds([...existingLabelIds, ...incoming]);
        break;
      case 'remove':
        nextLabelIds = existingLabelIds.filter((id) => !incoming.includes(id));
        break;
      case 'replace':
      default:
        nextLabelIds = incoming;
        break;
    }
  }

  const record: TagRecord = {
    labelIds: nextLabelIds,
    updatedAt: timestamp
  };

  const nextNote = note === undefined ? existing?.note : note;
  if (hasText(nextNote)) {
    record.note = nextNote;
  }

  return record;
};

/**
 * Cascades label deletion to a tag record while preserving user-authored notes.
 */
export const cascadeLabelDeletion = (
  record: TagRecord,
  deletedLabelId: string,
  timestamp: number
): TagRecord => {
  const next: TagRecord = {
    labelIds: normaliseLabelIds(record.labelIds).filter((id) => id !== deletedLabelId),
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
  return record.labelIds.length === 0 && !hasText(record.note);
};
