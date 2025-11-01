import type { ColumnType, SortDefinition } from './types';
import type { MaterializedRow } from './utils/materializeRowBatch';

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
