// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { profileColumn, timeHistogram } from './columnStats';
import { encodeColumn, RowBatchStore } from './rowBatchStore';

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

describe('profileColumn', () => {
  it('summarises a numeric column with typed min/max/mean and invalid counts', async () => {
    const store = await createStore({ n: ['10', '9', '', 'n/a', '100', '9', ' '] });
    const profile = await profileColumn(store, null, 'n', 'number');
    expect(profile).toMatchObject({
      column: 'n',
      type: 'number',
      rows: 7,
      emptyCount: 2,
      invalidCount: 1,
      distinctCount: 4,
      distinctCapped: false,
      min: '9',
      max: '100',
      mean: 32,
      minLength: 1,
      maxLength: 3
    });
    expect(profile.topValues[0]).toEqual({ value: '9', count: 2 });
  });

  it('uses UTC instants for datetime min/max', async () => {
    const store = await createStore({ t: ['2024-01-01T01:00:00+02:00', '2023-12-31 23:30', 'bad'] });
    const profile = await profileColumn(store, null, 't', 'datetime');
    // 2024-01-01T01:00+02:00 is 2023-12-31T23:00Z, earlier than the naive (UTC) 23:30.
    expect(profile.min).toBe('2024-01-01T01:00:00+02:00');
    expect(profile.max).toBe('2023-12-31 23:30');
    expect(profile.invalidCount).toBe(1);
    expect(profile.mean).toBeNull();
  });

  it('uses natural collation for text and never reports invalid values', async () => {
    const store = await createStore({ s: ['item10', 'item9', 'Item2', 'b', 'b'] });
    const profile = await profileColumn(store, null, 's', 'string');
    expect(profile.min).toBe('b');
    expect(profile.max).toBe('item10');
    expect(profile.invalidCount).toBe(0);
    expect(profile.topValues.map((entry) => entry.value)).toEqual(['b', 'item10', 'Item2', 'item9']);
  });

  it('respects the row mask', async () => {
    const store = await createStore({ n: ['1', '2', '3', '4'] });
    const profile = await profileColumn(store, Uint8Array.from([0, 1, 0, 1]), 'n', 'number');
    expect(profile.rows).toBe(2);
    expect(profile.mean).toBe(3);
  });

  it('returns empty statistics for a column without values', async () => {
    const store = await createStore({ n: ['', ''] });
    const profile = await profileColumn(store, null, 'n', 'number');
    expect(profile).toMatchObject({ rows: 2, emptyCount: 2, min: null, max: null, mean: null, minLength: 0, topValues: [] });
  });
});

describe('timeHistogram', () => {
  const hour = 3_600_000;

  it('buckets UTC instants evenly between the earliest and latest value', async () => {
    const store = await createStore({
      t: ['2024-01-01 00:00', '2024-01-01T00:30:00Z', 'nope', '2024-01-01 02:00+01:00', '2024-01-01 03:59:59.999', '']
    });
    const result = await timeHistogram(store, null, 't', 4);
    expect(result.start).toBe(Date.UTC(2024, 0, 1));
    expect(result.bucketMs).toBe(hour);
    expect(result.counts).toEqual([2, 1, 0, 1]);
    expect(result.datedRows).toBe(4);
  });

  it('puts every value in the first bucket when all times are equal', async () => {
    const store = await createStore({ t: ['2024-01-01', '2024-01-01'] });
    const result = await timeHistogram(store, null, 't', 3);
    expect(result.counts).toEqual([2, 0, 0]);
    expect(result.bucketMs).toBe(1);
  });

  it('respects the row mask and reports no data when nothing parses', async () => {
    const store = await createStore({ t: ['2024-01-01', 'x'] });
    expect(await timeHistogram(store, Uint8Array.from([0, 1]), 't', 5)).toEqual({
      column: 't',
      start: null,
      bucketMs: 0,
      counts: [],
      datedRows: 0
    });
  });
});
