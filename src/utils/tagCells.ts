import type { LabelDefinition, TagRecord } from '@workers/types';

export interface TagCellValue {
  rowId: number;
  labelId: string | null;
  labelName?: string;
  color?: string;
  note?: string;
  updatedAt: number;
}

const hasText = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

export const buildTagCellValue = (
  rowId: number | null | undefined,
  tags: Record<number, TagRecord>,
  labels: Map<string, LabelDefinition>
): TagCellValue | null => {
  if (!Number.isFinite(rowId) || rowId == null || rowId < 0) {
    return null;
  }

  const record = tags[rowId];
  if (!record) {
    return null;
  }

  const label = record.labelId ? labels.get(record.labelId) : undefined;
  const note = hasText(record.note) ? record.note.trim() : undefined;

  if (!label && record.labelId != null && !note) {
    // Label referenced is missing and there is no note to render; treat as empty.
    return null;
  }

  if (label?.id == null && !note) {
    return null;
  }

  return {
    rowId,
    labelId: record.labelId ?? null,
    labelName: label?.name,
    color: record.color || label?.color,
    note,
    updatedAt: record.updatedAt
  };
};
