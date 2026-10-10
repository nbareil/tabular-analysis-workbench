// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { groupRows, normaliseGroupColumns, resolveAggregationAlias } from './groupEngine';
import { encodeColumn, RowBatchStore } from './rowBatchStore';
import type { ColumnType } from './types';

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

const columns = {
  host: ['web', 'db', 'web', '', 'db', 'web'],
  bytes: ['10', '5', 'n/a', '7', '', '2.5'],
  when: ['2024-01-02 00:00', '2024-01-01T23:00:00-02:00', '', '2024-01-01', '2024-01-03', '2023-12-31'],
  name: ['b', 'file10', 'A', 'z', 'file2', 'c']
};
const types: Record<string, ColumnType> = { host: 'string', bytes: 'number', when: 'datetime', name: 'string' };

describe('groupRows', () => {
  it('groups by raw text in first-seen order with empty keys as null', async () => {
    const store = await createStore(columns);
    const result = await groupRows(store, null, types, { groupBy: 'host', aggregations: [] });
    expect(result.groupBy).toEqual(['host']);
    expect(result.rows).toEqual([
      { key: 'web', rowCount: 3, aggregates: { count: 3 } },
      { key: 'db', rowCount: 2, aggregates: { count: 2 } },
      { key: null, rowCount: 1, aggregates: { count: 1 } }
    ]);
    expect(result.totalGroups).toBe(3);
    expect(result.totalRows).toBe(6);
  });

  it('computes count/sum/avg over parseable numbers only', async () => {
    const store = await createStore(columns);
    const result = await groupRows(store, null, types, {
      groupBy: 'host',
      aggregations: [
        { operator: 'count' },
        { operator: 'count', column: 'bytes' },
        { operator: 'sum', column: 'bytes' },
        { operator: 'avg', column: 'bytes', alias: 'mean' }
      ]
    });
    const byKey = Object.fromEntries(result.rows.map((row) => [String(row.key), row.aggregates]));
    expect(byKey.web).toEqual({ count: 3, 'count(bytes)': 3, 'sum(bytes)': 12.5, mean: 6.25 });
    expect(byKey.db).toEqual({ count: 2, 'count(bytes)': 1, 'sum(bytes)': 5, mean: 5 });
  });

  it('returns null sum/avg when a group has no numeric values', async () => {
    const store = await createStore({ g: ['a'], v: ['x'] });
    const result = await groupRows(store, null, { v: 'number' }, {
      groupBy: 'g',
      aggregations: [{ operator: 'sum', column: 'v' }, { operator: 'avg', column: 'v' }, { operator: 'min', column: 'v' }]
    });
    expect(result.rows[0]!.aggregates).toEqual({ 'sum(v)': null, 'avg(v)': null, 'min(v)': null });
  });

  it('computes min/max with typed comparison and returns the raw text', async () => {
    const store = await createStore(columns);
    const result = await groupRows(store, null, types, {
      groupBy: 'host',
      aggregations: [
        { operator: 'min', column: 'when' },
        { operator: 'max', column: 'when' },
        { operator: 'min', column: 'bytes' },
        { operator: 'max', column: 'name' }
      ]
    });
    const byKey = Object.fromEntries(result.rows.map((row) => [String(row.key), row.aggregates]));
    expect(byKey.web).toEqual({
      'min(when)': '2023-12-31',
      'max(when)': '2024-01-02 00:00',
      'min(bytes)': '2.5',
      'max(name)': 'c'
    });
    // 2024-01-01T23:00-02:00 is 2024-01-02T01:00Z, which is before 2024-01-03.
    expect(byKey.db!['min(when)']).toBe('2024-01-01T23:00:00-02:00');
    expect(byKey.db!['max(name)']).toBe('file10');
  });

  it('keeps multi-column keys distinct when values contain separators', async () => {
    const store = await createStore({ a: ['x|y', 'x', 'x|y'], b: ['z', 'y|z', 'z'] });
    const result = await groupRows(store, null, {}, { groupBy: ['a', 'b'], aggregations: [] });
    expect(result.rows.map((row) => [row.key, row.rowCount])).toEqual([
      [['x|y', 'z'], 2],
      [['x', 'y|z'], 1]
    ]);
  });

  it('distinguishes a null key from the text "null"', async () => {
    const store = await createStore({ a: ['', 'null'] });
    const result = await groupRows(store, null, {}, { groupBy: ['a'], aggregations: [] });
    expect(result.rows.map((row) => row.key)).toEqual([null, 'null']);
  });

  it('only groups rows selected by the mask', async () => {
    const store = await createStore(columns);
    const mask = Uint8Array.from([1, 0, 0, 0, 1, 1]);
    const result = await groupRows(store, mask, types, { groupBy: 'host', aggregations: [] });
    expect(result.rows.map((row) => [row.key, row.rowCount])).toEqual([
      ['web', 2],
      ['db', 1]
    ]);
    expect(result.totalRows).toBe(3);
  });

  it('pages groups with offset and limit but reports the total', async () => {
    const store = await createStore(columns);
    const result = await groupRows(store, null, types, { groupBy: 'host', aggregations: [], offset: 1, limit: 1 });
    expect(result.rows.map((row) => row.key)).toEqual(['db']);
    expect(result.totalGroups).toBe(3);
  });
});

describe('group helpers', () => {
  it('resolves aliases', () => {
    expect(resolveAggregationAlias({ operator: 'count' })).toBe('count');
    expect(resolveAggregationAlias({ operator: 'sum', column: 'x' })).toBe('sum(x)');
    expect(resolveAggregationAlias({ operator: 'sum', column: 'x', alias: 'total' })).toBe('total');
  });

  it('requires at least one group column', () => {
    expect(() => normaliseGroupColumns([])).toThrow();
    expect(normaliseGroupColumns('a')).toEqual(['a']);
  });
});
