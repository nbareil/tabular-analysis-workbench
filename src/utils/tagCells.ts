import type { LabelDefinition, TagRecord } from '@workers/types';

export interface TagLabelView {
  id: string;
  name: string;
  color?: string;
}

export interface TagCellValue {
  rowId: number;
  labels: TagLabelView[];
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

  const resolvedLabels: TagLabelView[] = [];
  for (const labelId of record.labelIds ?? []) {
    const match = labels.get(labelId);
    if (match) {
      resolvedLabels.push({
        id: match.id,
        name: match.name,
        color: match.color
      });
    }
  }
  const note = hasText(record.note) ? record.note.trim() : undefined;

  if (resolvedLabels.length === 0 && !note) {
    return null;
  }

  return {
    rowId,
    labels: resolvedLabels,
    note,
    updatedAt: record.updatedAt
  };
};
