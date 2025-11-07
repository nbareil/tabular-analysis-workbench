import type { ColumnType, SortDefinition } from './types';
import type { MaterializedRow } from './utils/materializeRowBatch';
import { RowBatchStore } from './rowBatchStore';

const compareStrings = (a: unknown, b: unknown): number => {
  const aStr = a == null ? '' : String(a);
  const bStr = b == null ? '' : String(b);
  return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' });
};

const compareNumbers = (a: unknown, b: unknown): number => {
  const aNum = typeof a === 'number' ? a : Number(a);
  const bNum = typeof b === 'number' ? b : Number(b);

  if (!Number.isFinite(aNum) && !Number.isFinite(bNum)) {
    return 0;
  }

  if (!Number.isFinite(aNum)) {
    return 1;
  }

  if (!Number.isFinite(bNum)) {
    return -1;
  }

  if (aNum === bNum) {
    return 0;
  }

  return aNum < bNum ? -1 : 1;
};

const compareBooleans = (a: unknown, b: unknown): number => {
  const aBool = typeof a === 'boolean' ? a : Boolean(a);
  const bBool = typeof b === 'boolean' ? b : Boolean(b);
  if (aBool === bBool) {
    return 0;
  }
  return aBool ? 1 : -1;
};

const compareDatetimes = (a: unknown, b: unknown): number => {
  const aTime = typeof a === 'number' ? a : Date.parse(String(a ?? ''));
  const bTime = typeof b === 'number' ? b : Date.parse(String(b ?? ''));

  if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) {
    return 0;
  }

  if (!Number.isFinite(aTime)) {
    return 1;
  }

  if (!Number.isFinite(bTime)) {
    return -1;
  }

  if (aTime === bTime) {
    return 0;
  }

  return aTime < bTime ? -1 : 1;
};

const compareByType = (type: ColumnType, a: unknown, b: unknown): number => {
  switch (type) {
    case 'number':
      return compareNumbers(a, b);
    case 'boolean':
      return compareBooleans(a, b);
    case 'datetime':
      return compareDatetimes(a, b);
    case 'string':
    default:
      return compareStrings(a, b);
  }
};

export const compareValues = compareByType;

const compareRows = (
  rowA: MaterializedRow,
  rowB: MaterializedRow,
  columnTypes: Record<string, ColumnType>,
  sorts: SortDefinition[]
): number => {
  for (const sort of sorts) {
    const type = columnTypes[sort.column] ?? 'string';
    const result = compareByType(type, rowA[sort.column], rowB[sort.column]);

    if (result !== 0) {
      return sort.direction === 'desc' ? -result : result;
    }
  }

  return 0;
};

export const sortMaterializedRows = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  sorts: SortDefinition[]
): { rows: MaterializedRow[] } => {
  if (!sorts.length) {
    return { rows: rows.slice() };
  }

  const sorted = rows.slice();
  sorted.sort((rowA, rowB) => compareRows(rowA, rowB, columnTypes, sorts));
  return { rows: sorted };
};

export const sortRowIdsProgressive = async (
  batchStore: RowBatchStore,
  baseRowIds: number[],
  columnTypes: Record<string, ColumnType>,
  sorts: SortDefinition[],
  visibleRowCount: number
): Promise<{ sortedRowIds: Uint32Array; sortComplete: boolean; backgroundPromise?: Promise<Uint32Array> }> => {
  if (!sorts.length) {
    return { sortedRowIds: Uint32Array.from(baseRowIds), sortComplete: true };
  }

  // For small datasets, sort everything at once
  if (baseRowIds.length <= visibleRowCount * 2) {
    const sortedRowIds = await sortRowIds(batchStore, baseRowIds, columnTypes, sorts);
    return { sortedRowIds, sortComplete: true };
  }

  // Sort visible rows first for immediate UI feedback
  const visibleRows = baseRowIds.slice(0, visibleRowCount);
  const sortedVisibleRowIds = await sortRowIds(batchStore, visibleRows, columnTypes, sorts);

  // Start background sorting of remaining rows
  const remainingRows = baseRowIds.slice(visibleRowCount);

  // For now, return partial results and indicate background work is needed
  // In a real implementation, we'd return a promise that completes the background work
  const combinedRowIds = new Uint32Array(baseRowIds.length);
  combinedRowIds.set(sortedVisibleRowIds, 0);
  // Keep remaining rows in original order initially
  combinedRowIds.set(Uint32Array.from(remainingRows), visibleRowCount);

  // Return partial results with a promise for completion
  const backgroundPromise = sortRowIds(batchStore, remainingRows, columnTypes, sorts).then(sortedRemaining => {
    // Create final sorted array by merging visible and remaining
    const finalSorted = new Uint32Array(baseRowIds.length);
    finalSorted.set(sortedVisibleRowIds, 0);
    finalSorted.set(sortedRemaining, visibleRowCount);
    return finalSorted;
  });

  return {
    sortedRowIds: combinedRowIds,
    sortComplete: false,
    backgroundPromise
  };
};

export const sortRowIds = async (
  batchStore: RowBatchStore,
  baseRowIds: number[],
  columnTypes: Record<string, ColumnType>,
  sorts: SortDefinition[]
): Promise<Uint32Array> => {
  const rowIndexMap = new Map<number, number>();
  baseRowIds.forEach((rowId, index) => {
    rowIndexMap.set(rowId, index);
  });

  const valueVectors = sorts.map(() => new Array<unknown>(baseRowIds.length));

  for await (const { rowStart, rows } of batchStore.iterateMaterializedBatches()) {
    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx]!;
      const absoluteRowId = rowStart + idx;
      const position = rowIndexMap.get(absoluteRowId);
      if (position == null) {
        continue;
      }

      for (let sortIdx = 0; sortIdx < sorts.length; sortIdx += 1) {
        const sort = sorts[sortIdx]!;
        valueVectors[sortIdx]![position] = row[sort.column];
      }
    }
  }

  const sortedRowIdsArray = baseRowIds.slice();
  sortedRowIdsArray.sort((leftId, rightId) => {
    for (let sortIdx = 0; sortIdx < sorts.length; sortIdx += 1) {
      const sort = sorts[sortIdx]!;
      const columnType = columnTypes[sort.column] ?? 'string';
      const values = valueVectors[sortIdx]!;
      const leftValue = values[rowIndexMap.get(leftId)!];
      const rightValue = values[rowIndexMap.get(rightId)!];
      const comparison = compareByType(columnType, leftValue, rightValue);

      if (comparison !== 0) {
        return sort.direction === 'desc' ? -comparison : comparison;
      }
    }
    return leftId - rightId;
  });

  return Uint32Array.from(sortedRowIdsArray);
};
