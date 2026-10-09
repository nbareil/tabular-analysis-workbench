import type { ColumnState, GridApi } from 'ag-grid-community';

import type { LoaderStatus } from '@state/dataStore';
import type { FilterState } from '@state/sessionStore';
import type { SortDefinition } from '@workers/types';
import type { TagCellValue } from '@utils/tagCells';

export interface FilterMenuMetadata {
  eqIndex: number;
  eqMatchesValue: boolean;
  neqExists: boolean;
}

export const evaluateFilterMenuMetadata = (
  filters: FilterState[],
  columnId: string,
  valueAsString: string
): FilterMenuMetadata => {
  const eqIndex = filters.findIndex(
    (filter) => filter.enabled !== false && filter.column === columnId && filter.operator === 'eq'
  );

  const eqMatchesValue =
    eqIndex >= 0 &&
    String(filters[eqIndex]!.value ?? '') === valueAsString;

  const neqExists = filters.some(
    (filter) =>
      filter.enabled !== false &&
      filter.column === columnId &&
      filter.operator === 'neq' &&
      String(filter.value ?? '') === valueAsString
  );

  return {
    eqIndex,
    eqMatchesValue,
    neqExists
  };
};

export const sortsEqual = (left: SortDefinition[], right: SortDefinition[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (sort, index) =>
      sort.column === right[index]?.column && sort.direction === right[index]?.direction
  );
};

export const buildSortStateFromColumnState = (columnState: ColumnState[]): SortDefinition[] =>
  columnState
    .filter((state) => state.sort != null)
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map((state) => ({
      column: state.colId ?? '',
      direction: state.sort === 'desc' ? ('desc' as const) : ('asc' as const)
    }))
    .filter((sort) => Boolean(sort.column));

export interface HeaderContextMenuState {
  kind: 'header';
  x: number;
  y: number;
  columnId: string;
}

export interface CellContextMenuState {
  kind: 'cell';
  x: number;
  y: number;
  columnId: string;
  displayValue: string;
  filterValue: string | null;
  rowId: number | null;
  cellClipboardText: string;
}

export type GridContextMenuState = HeaderContextMenuState | CellContextMenuState;
export type DistributionSortOrder = 'asc' | 'desc';

export const AUTO_WIDTH_MAX_SAMPLE_ROWS = 1_000;
export const AUTO_WIDTH_BLOCK_SIZE = 250;
export const CELL_HORIZONTAL_PADDING_PX = 32;
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 520;

export const computeMedianWidth = (samples: number[]): number => {
  if (!samples.length) {
    return MIN_COLUMN_WIDTH;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middleIndex] ?? MIN_COLUMN_WIDTH;
  }

  const left = sorted[middleIndex - 1] ?? MIN_COLUMN_WIDTH;
  const right = sorted[middleIndex] ?? MIN_COLUMN_WIDTH;
  return (left + right) / 2;
};

export const computeAutoColumnWidth = ({
  valueSamples,
  headerWidth
}: {
  valueSamples: number[];
  headerWidth: number;
}): number => {
  const medianValueWidth = valueSamples.length
    ? computeMedianWidth(valueSamples)
    : MIN_COLUMN_WIDTH;
  const measuredWidth = Math.max(headerWidth, medianValueWidth);
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.ceil(measuredWidth)));
};

export const getNextRowIndex = ({
  rowCount,
  currentIndex,
  direction
}: {
  rowCount: number;
  currentIndex: number | null;
  direction: 'up' | 'down';
}): number | null => {
  if (rowCount <= 0) {
    return null;
  }

  if (currentIndex == null || Number.isNaN(currentIndex)) {
    return direction === 'down' ? 0 : rowCount - 1;
  }

  const delta = direction === 'down' ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(rowCount - 1, currentIndex + delta));
  return nextIndex;
};

export const getEmptyStateMessage = ({
  status,
  totalRows,
  matchedRows
}: {
  status: LoaderStatus;
  totalRows: number;
  matchedRows: number | null;
}): string => {
  if (status === 'loading') {
    return 'Loading rows…';
  }

  if (totalRows > 0 && matchedRows === 0) {
    return 'No rows match the current filters or search.';
  }

  return 'Select a CSV or TSV file to begin.';
};

export const shouldShowInitialPlaceholder = ({
  status,
  totalRows,
  columnCount
}: {
  status: LoaderStatus;
  totalRows: number;
  columnCount: number;
}): boolean => status !== 'loading' && totalRows === 0 && columnCount === 0;

export const shouldShowEmptyOverlay = ({
  status,
  totalRows,
  matchedRows,
  columnCount
}: {
  status: LoaderStatus;
  totalRows: number;
  matchedRows: number | null;
  columnCount: number;
}): boolean =>
  status !== 'loading' && totalRows > 0 && matchedRows === 0 && columnCount > 0;

export const toggleRowSelection = (gridApi: GridApi | null, rowId: number | null): boolean => {
  if (!gridApi || rowId == null) {
    return false;
  }

  const rowNode = gridApi.getRowNode(String(rowId));
  if (!rowNode || typeof rowNode.setSelected !== 'function') {
    return false;
  }

  const currentlySelected =
    typeof rowNode.isSelected === 'function' ? rowNode.isSelected() : false;
  rowNode.setSelected(!currentlySelected, false, 'api');
  return true;
};

export interface ClipboardColumnValue {
  headerName: string;
  value: unknown;
}

const normalizeClipboardText = (value: string): string => value.replace(/[\t\r\n]+/g, ' ');

export const isTagCellValue = (value: unknown): value is TagCellValue =>
  value != null &&
  typeof value === 'object' &&
  ('labels' in value || 'note' in value);

export const formatClipboardCellValue = (value: unknown): string => {
  if (value == null) {
    return '';
  }

  if (isTagCellValue(value)) {
    const labels = value.labels.map((label) => label.name).filter(Boolean);
    const segments: string[] = [];

    if (labels.length > 0) {
      segments.push(labels.join(', '));
    }

    if (typeof value.note === 'string' && value.note.trim().length > 0) {
      segments.push(`note: ${value.note}`);
    }

    return normalizeClipboardText(segments.join(' | '));
  }

  if (Array.isArray(value)) {
    return normalizeClipboardText(value.map((item) => formatClipboardCellValue(item)).join(', '));
  }

  if (typeof value === 'object') {
    return normalizeClipboardText(JSON.stringify(value));
  }

  return normalizeClipboardText(String(value));
};

export const sortDistributionItems = (
  items: Array<{ value: string; count: number }>,
  direction: DistributionSortOrder
): Array<{ value: string; count: number }> =>
  [...items].sort((left, right) => {
    if (left.count !== right.count) {
      return direction === 'asc' ? left.count - right.count : right.count - left.count;
    }

    return left.value.localeCompare(right.value);
  });

export const serializeRowForClipboard = (columns: ClipboardColumnValue[]): string => {
  if (columns.length === 0) {
    return '';
  }

  const headers = columns.map((column) => normalizeClipboardText(column.headerName));
  const values = columns.map((column) => formatClipboardCellValue(column.value));
  return `${headers.join('\t')}\n${values.join('\t')}`;
};

export const serializeRowsForClipboard = (rows: ClipboardColumnValue[][]): string => {
  if (rows.length === 0) {
    return '';
  }

  const [firstRow] = rows;
  if (!firstRow || firstRow.length === 0) {
    return '';
  }

  const headers = firstRow.map((column) => normalizeClipboardText(column.headerName));
  const serializedRows = rows.map((row) =>
    row.map((column) => formatClipboardCellValue(column.value)).join('\t')
  );

  return `${headers.join('\t')}\n${serializedRows.join('\n')}`;
};

export const getHeaderContextMenuColumnId = (target: EventTarget | null): string | null => {
  if (!(target instanceof Element)) {
    return null;
  }

  const headerCell = target.closest<HTMLElement>('.ag-header-cell[col-id]');
  return headerCell?.getAttribute('col-id') ?? null;
};

export const isWithinGridContextMenu = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('[data-grid-context-menu="true"]') != null;
