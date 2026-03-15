import type { GridColumn } from '@state/dataStore';
import type { ColumnLayoutState, FilterState } from '@state/sessionStore';
import type { ColumnInference, FilterNode } from '@workers/types';
import { buildFilterExpression } from './filterExpression';

export interface ResolvedEventTimelineConfig {
  column: string;
  columnLabel: string;
  expression: FilterNode | null;
  rangeStart: number;
  rangeEnd: number;
  selectedStart: number | null;
  selectedEnd: number | null;
}

const toFiniteTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

const buildOrderedColumns = (
  columns: GridColumn[],
  columnLayout: ColumnLayoutState
): GridColumn[] => {
  const baseOrder = columnLayout.order.length
    ? columnLayout.order
    : columns.map((column) => column.key);
  const additions = columns
    .map((column) => column.key)
    .filter((key) => !baseOrder.includes(key));
  const finalOrder = [...baseOrder, ...additions];

  return finalOrder
    .map((key) => columns.find((column) => column.key === key))
    .filter((column): column is GridColumn => Boolean(column));
};

export const buildNonDatetimeFilterExpression = ({
  filters,
  columns
}: {
  filters: FilterState[];
  columns: GridColumn[];
}): FilterNode | null => {
  const datetimeColumns = new Set(
    columns.filter((column) => column.type === 'datetime').map((column) => column.key)
  );

  return buildFilterExpression(
    filters.filter((filter) => !datetimeColumns.has(filter.column))
  );
};

export const resolveEventTimelineConfig = ({
  filters,
  columns,
  columnLayout,
  columnInference
}: {
  filters: FilterState[];
  columns: GridColumn[];
  columnLayout: ColumnLayoutState;
  columnInference: Record<string, ColumnInference>;
}): ResolvedEventTimelineConfig | null => {
  const orderedColumns = buildOrderedColumns(columns, columnLayout);
  const columnMap = Object.fromEntries(columns.map((column) => [column.key, column]));
  const activeDatetimeRangeFilter =
    filters.find(
      (filter) =>
        filter.enabled !== false &&
        filter.operator === 'between' &&
        columnMap[filter.column]?.type === 'datetime'
    ) ?? null;

  const sourceColumn =
    (activeDatetimeRangeFilter
      ? columnMap[activeDatetimeRangeFilter.column]
      : orderedColumns.find((column) => column.type === 'datetime')) ?? null;
  if (!sourceColumn) {
    return null;
  }

  const inference = columnInference[sourceColumn.key];
  const inferredStart = toFiniteTimestamp(inference?.minDatetime);
  const inferredEnd = toFiniteTimestamp(inference?.maxDatetime);

  const selectedStart = activeDatetimeRangeFilter
    ? toFiniteTimestamp(activeDatetimeRangeFilter.value) ?? inferredStart
    : null;
  const selectedEnd = activeDatetimeRangeFilter
    ? toFiniteTimestamp(activeDatetimeRangeFilter.value2) ?? inferredEnd
    : null;

  const rangeStart = inferredStart ?? selectedStart;
  const rangeEnd = inferredEnd ?? selectedEnd;
  if (rangeStart == null || rangeEnd == null) {
    return null;
  }

  return {
    column: sourceColumn.key,
    columnLabel: sourceColumn.headerName || sourceColumn.key,
    expression: buildNonDatetimeFilterExpression({
      filters,
      columns
    }),
    rangeStart: Math.min(rangeStart, rangeEnd),
    rangeEnd: Math.max(rangeStart, rangeEnd),
    selectedStart:
      selectedStart != null && selectedEnd != null
        ? Math.min(selectedStart, selectedEnd)
        : null,
    selectedEnd:
      selectedStart != null && selectedEnd != null
        ? Math.max(selectedStart, selectedEnd)
        : null
  };
};
