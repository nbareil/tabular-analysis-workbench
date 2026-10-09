import type { RowBatchStore } from './rowBatchStore';
import type { ColumnType, SortDefinition } from './types';
import { parseBoolean, parseDatetime, parseNumber } from './valueParsing';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

type SortKeys = { kind: 'number'; values: Float64Array } | { kind: 'string'; values: string[] };

const createKeys = (type: ColumnType, length: number): SortKeys =>
  type === 'string'
    ? { kind: 'string', values: new Array<string>(length).fill('') }
    : { kind: 'number', values: new Float64Array(length).fill(Number.NaN) };

const numericKey = (type: ColumnType, raw: string): number => {
  if (type === 'datetime') {
    return parseDatetime(raw) ?? Number.NaN;
  }
  if (type === 'boolean') {
    const parsed = parseBoolean(raw);
    return parsed == null ? Number.NaN : Number(parsed);
  }
  return parseNumber(raw) ?? Number.NaN;
};

/**
 * Sorts `rowIds` by the given sort definitions. Empty or unparseable values always sort last,
 * whatever the direction; ties keep file order.
 */
export const sortRowIds = async (
  batchStore: RowBatchStore,
  rowIds: Uint32Array,
  columnTypes: Record<string, ColumnType>,
  sorts: SortDefinition[],
  checkCancelled: () => void = () => undefined
): Promise<Uint32Array> => {
  if (!sorts.length || rowIds.length < 2) {
    return rowIds.slice();
  }

  const positionByRow = new Int32Array(batchStore.totalRows).fill(-1);
  rowIds.forEach((rowId, position) => {
    positionByRow[rowId] = position;
  });

  const types = sorts.map((sort) => columnTypes[sort.column] ?? 'string');
  const keys = types.map((type) => createKeys(type, rowIds.length));

  for await (const view of batchStore.iterateBatches()) {
    checkCancelled();
    sorts.forEach((sort, sortIndex) => {
      const values = view.column(sort.column);
      const key = keys[sortIndex]!;
      for (let index = 0; index < view.rowCount; index += 1) {
        const position = positionByRow[view.rowStart + index]!;
        if (position === -1) {
          continue;
        }
        if (key.kind === 'string') {
          key.values[position] = values[index]!.trim();
        } else {
          key.values[position] = numericKey(types[sortIndex]!, values[index]!);
        }
      }
    });
  }

  const order = new Uint32Array(rowIds.length);
  for (let index = 0; index < order.length; index += 1) {
    order[index] = index;
  }

  order.sort((left, right) => {
    for (let sortIndex = 0; sortIndex < sorts.length; sortIndex += 1) {
      const key = keys[sortIndex]!;
      const direction = sorts[sortIndex]!.direction === 'desc' ? -1 : 1;
      if (key.kind === 'string') {
        const a = key.values[left]!;
        const b = key.values[right]!;
        if (a === b) {
          continue;
        }
        if (!a || !b) {
          return a ? -1 : 1;
        }
        const comparison = collator.compare(a, b);
        if (comparison !== 0) {
          return comparison * direction;
        }
      } else {
        const a = key.values[left]!;
        const b = key.values[right]!;
        const aMissing = Number.isNaN(a);
        const bMissing = Number.isNaN(b);
        if (aMissing || bMissing) {
          if (aMissing !== bMissing) {
            return aMissing ? 1 : -1;
          }
          continue;
        }
        if (a !== b) {
          return (a < b ? -1 : 1) * direction;
        }
      }
    }
    return rowIds[left]! - rowIds[right]!;
  });

  checkCancelled();
  return order.map((position) => rowIds[position]!);
};
