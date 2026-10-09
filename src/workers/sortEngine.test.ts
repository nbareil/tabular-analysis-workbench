// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { encodeColumn } from './csvParser';
import { RowBatchStore } from './rowBatchStore';
import { sortRowIds } from './sortEngine';
import type { ColumnType, SortDefinition } from './types';

const createStore = async (columns: Record<string, string[]>, batchSize = 2): Promise<RowBatchStore> => {
  const store = await RowBatchStore.create('sort-test');
  const rowCount = Object.values(columns)[0]!.length;
  for (let start = 0; start < rowCount; start += batchSize) {
    const end = Math.min(rowCount, start + batchSize);
    await store.storeBatch({
      rowIds: Uint32Array.from({ length: end - start }, (_, index) => start + index),
      columns: Object.fromEntries(
        Object.entries(columns).map(([name, values]) => [name, encodeColumn(values.slice(start, end))])
      ),
      columnTypes: {},
      columnInference: {},
      stats: { rowsParsed: end, bytesParsed: 0, malformedRows: 0, eof: false }
    });
  }
  return store;
};

const sortAll = async (
  columns: Record<string, string[]>,
  types: Record<string, ColumnType>,
  sorts: SortDefinition[]
): Promise<number[]> => {
  const store = await createStore(columns);
  const rowIds = Uint32Array.from({ length: store.totalRows }, (_, index) => index);
  return Array.from(await sortRowIds(store, rowIds, types, sorts));
};

describe('sortRowIds', () => {
  it('sorts numbers numerically and puts empty or invalid values last in both directions', async () => {
    const columns = { n: ['10', '', '9', 'n/a', '-1', '100'] };
    expect(await sortAll(columns, { n: 'number' }, [{ column: 'n', direction: 'asc' }])).toEqual([4, 2, 0, 5, 1, 3]);
    expect(await sortAll(columns, { n: 'number' }, [{ column: 'n', direction: 'desc' }])).toEqual([5, 0, 2, 4, 1, 3]);
  });

  it('uses natural, case-insensitive collation for strings with empties last', async () => {
    const columns = { s: ['file10', '', 'File2', 'file1', '  '] };
    expect(await sortAll(columns, { s: 'string' }, [{ column: 's', direction: 'asc' }])).toEqual([3, 2, 0, 1, 4]);
    expect(await sortAll(columns, { s: 'string' }, [{ column: 's', direction: 'desc' }])).toEqual([0, 2, 3, 1, 4]);
  });

  it('keeps file order for ties in both directions', async () => {
    const columns = { s: ['b', 'a', 'B', 'A', 'b'] };
    expect(await sortAll(columns, { s: 'string' }, [{ column: 's', direction: 'asc' }])).toEqual([1, 3, 0, 2, 4]);
    expect(await sortAll(columns, { s: 'string' }, [{ column: 's', direction: 'desc' }])).toEqual([0, 2, 4, 1, 3]);
  });

  it('orders datetimes as UTC instants across formats and zones', async () => {
    const columns = {
      t: [
        '2024-01-01T00:30:00+01:00', // 2023-12-31T23:30Z
        '2023-12-31 23:45', // naive, so UTC: later than row 0
        '1704067200', // 2024-01-01T00:00Z
        ''
      ]
    };
    expect(await sortAll(columns, { t: 'datetime' }, [{ column: 't', direction: 'asc' }])).toEqual([0, 1, 2, 3]);
  });

  it('orders microsecond timestamps that share the same millisecond', async () => {
    const columns = {
      t: ['2024-01-01T00:00:00.000003Z', '2024-01-01T00:00:00.000001Z', '2024-01-01T00:00:00.000002Z']
    };
    expect(await sortAll(columns, { t: 'datetime' }, [{ column: 't', direction: 'asc' }])).toEqual([1, 2, 0]);
  });

  it('sorts booleans false before true', async () => {
    const columns = { b: ['yes', '', 'no', 'true'] };
    expect(await sortAll(columns, { b: 'boolean' }, [{ column: 'b', direction: 'asc' }])).toEqual([2, 0, 3, 1]);
  });

  it('applies secondary sorts to ties of the first', async () => {
    const columns = { g: ['b', 'a', 'b', 'a'], n: ['1', '5', '3', '2'] };
    const result = await sortAll(columns, { g: 'string', n: 'number' }, [
      { column: 'g', direction: 'asc' },
      { column: 'n', direction: 'desc' }
    ]);
    expect(result).toEqual([1, 3, 2, 0]);
  });

  it('sorts only the requested subset of rows', async () => {
    const store = await createStore({ n: ['5', '4', '3', '2', '1'] });
    const result = await sortRowIds(store, Uint32Array.from([0, 2, 4]), { n: 'number' }, [
      { column: 'n', direction: 'asc' }
    ]);
    expect(Array.from(result)).toEqual([4, 2, 0]);
  });

  it('returns a copy in the original order when there is nothing to sort', async () => {
    const store = await createStore({ n: ['2', '1'] });
    const rowIds = Uint32Array.from([1, 0]);
    const result = await sortRowIds(store, rowIds, { n: 'number' }, []);
    expect(Array.from(result)).toEqual([1, 0]);
    expect(result).not.toBe(rowIds);
  });

  it('propagates cancellation', async () => {
    const store = await createStore({ n: ['2', '1'] });
    const cancel = () => {
      throw new Error('cancelled');
    };
    await expect(
      sortRowIds(store, Uint32Array.from([0, 1]), { n: 'number' }, [{ column: 'n', direction: 'asc' }], cancel)
    ).rejects.toThrow('cancelled');
  });
});
