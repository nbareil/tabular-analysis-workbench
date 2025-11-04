import type { FilterState } from '@state/sessionStore';
import type { LabelDefinition } from '@workers/types';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from '@workers/types';

export interface LabelFilterSummary {
  summary: string;
  include: string[];
  exclude: string[];
}

const resolveLabelName = (
  value: string | null | undefined,
  labels: LabelDefinition[]
): string => {
  if (value == null || value === TAG_NO_LABEL_FILTER_VALUE) {
    return 'No label';
  }

  const match = labels.find((label) => label.id === value);
  if (match) {
    return match.name;
  }

  return `Unknown label (${value})`;
};

export const summariseLabelFilters = (
  filters: FilterState[],
  labels: LabelDefinition[]
): LabelFilterSummary | null => {
  const labelFilters = filters.filter((filter) => filter.column === TAG_COLUMN_ID);
  if (labelFilters.length === 0) {
    return null;
  }

  const include: string[] = [];
  const exclude: string[] = [];

  for (const filter of labelFilters) {
    const name = resolveLabelName(
      typeof filter.value === 'string' ? filter.value : (filter.value as string | null),
      labels
    );

    if (filter.operator === 'neq') {
      exclude.push(name);
    } else if (filter.operator === 'eq') {
      include.push(name);
    }
  }

  if (include.length === 0 && exclude.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (include.length > 0) {
    parts.push(`Labels: ${include.join(', ')}`);
  }
  if (exclude.length > 0) {
    parts.push(`Excluding: ${exclude.join(', ')}`);
  }

  return {
    summary: parts.join(' • '),
    include,
    exclude
  };
};
