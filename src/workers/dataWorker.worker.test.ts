// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('comlink', () => ({ expose: vi.fn() }));

import { createDataWorkerApi } from './dataWorker.worker';
import { RowBatchStore } from './rowBatchStore';
import type { ColumnValueDistributionResult, DataWorkerApi } from './workerApiTypes';
import type { FilterNode } from './types';
import { createMockFileHandle } from './test/mockFileHandle';

const CSV = [
  'name,city,score,seen',
  'Alice,Paris,30,2024-01-01T00:00:00Z',
  'Bob,London,10,2024-01-01T12:00:00Z',
  'Carol,Paris,20,2024-01-02T00:00:00Z',
  'Dave,Lisbon,40,',
  'Erin,Paris,=1+1,2024-01-03T00:00:00Z'
].join('\n');

const paris: FilterNode = { column: 'city', operator: 'eq', value: 'Paris' };

const loaded = async (csv = CSV, batchSize = 2): Promise<DataWorkerApi> => {
  const api = createDataWorkerApi();
  await api.init({});
  await api.loadFile({ handles: [createMockFileHandle(csv, { name: 'events.csv' })], batchSize }, {});
  return api;
};

const names = async (api: DataWorkerApi) =>
  (await api.fetchRows({ offset: 0, limit: 100 })).rows.map((row) => row.name);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dataWorkerApi loading and fetching', () => {
  it('returns empty results before a file is loaded', async () => {
    const api = createDataWorkerApi();
    expect(await api.fetchRows({ offset: 0, limit: 10 })).toEqual({ rows: [], totalRows: 0, matchedRows: 0 });
    expect(await api.getRowsById([0])).toEqual([]);
    await expect(api.exportCsv({ columns: [], scope: 'view' })).rejects.toThrow('No dataset loaded');
  });

  it('loads a file and pages rows as raw strings', async () => {
    const api = await loaded();
    const page = await api.fetchRows({ offset: 1, limit: 2 });
    expect(page.totalRows).toBe(5);
    expect(page.matchedRows).toBe(5);
    expect(page.rows.map((row) => [row.__rowId, row.name, row.score])).toEqual([
      [1, 'Bob', '10'],
      [2, 'Carol', '20']
    ]);
    expect((await api.fetchRows({ offset: 4, limit: 10 })).rows.map((row) => row.name)).toEqual(['Erin']);
  });

  it('merges several files through loadFile', async () => {
    const api = createDataWorkerApi();
    const onStart = vi.fn();
    await api.loadFile(
      {
        handles: [
          createMockFileHandle('host\na\n', { name: 'one.csv' }),
          createMockFileHandle('host\nb\n', { name: 'two.csv' })
        ]
      },
      { onStart }
    );
    expect(onStart).toHaveBeenLastCalledWith({ columns: ['source_file', 'host'] });
    const { rows } = await api.fetchRows({ offset: 0, limit: 10 });
    expect(rows.map((row) => [row.source_file, row.host])).toEqual([
      ['one.csv', 'a'],
      ['two.csv', 'b']
    ]);
  });

  it('a second loadFile supersedes the first', async () => {
    const api = createDataWorkerApi();
    const first = api.loadFile({ handles: [createMockFileHandle('a\n1\n')] }, {});
    const second = api.loadFile({ handles: [createMockFileHandle('b\n2\n')] }, {});
    await expect(first).rejects.toMatchObject({ name: 'StaleOperationError' });
    await second;
    expect((await api.fetchRows({ offset: 0, limit: 10 })).rows).toEqual([{ __rowId: 0, b: '2' }]);
  });

  it('getRowsById returns rows in the requested order and skips unknown ids', async () => {
    const api = await loaded();
    expect((await api.getRowsById([3, 0, 99])).map((row) => row.name)).toEqual(['Dave', 'Alice']);
  });
});

describe('dataWorkerApi view', () => {
  it('fetchRows follows filter, search and sort and reports matchedRows of the final view', async () => {
    const api = await loaded();
    expect((await api.applyFilter({ expression: paris })).matchedRows).toBe(3);
    expect(await names(api)).toEqual(['Alice', 'Carol', 'Erin']);

    expect(await api.globalSearch({ query: 'r', columns: ['name'] })).toEqual({ totalRows: 5, matchedRows: 2 });
    await api.applySorts({ sorts: [{ column: 'name', direction: 'desc' }] });
    const page = await api.fetchRows({ offset: 0, limit: 10 });
    expect(page.matchedRows).toBe(2);
    expect(page.rows.map((row) => row.name)).toEqual(['Erin', 'Carol']);
    expect((await api.fetchRows({ offset: 1, limit: 1 })).rows.map((row) => row.name)).toEqual(['Carol']);
  });

  it('findRowPosition maps row ids to view positions', async () => {
    const api = await loaded();
    expect(await api.findRowPosition(3)).toBe(3);
    expect(await api.findRowPosition(9)).toBe(-1);
    await api.applyFilter({ expression: paris });
    await api.applySorts({ sorts: [{ column: 'name', direction: 'desc' }] });
    expect(await api.findRowPosition(0)).toBe(2);
    expect(await api.findRowPosition(1)).toBe(-1);
  });

  it('findTaggedPosition walks the view to the next or previous tagged row', async () => {
    const api = await loaded();
    const { labels } = await api.loadTags();
    await api.tagRows({ rowIds: [0, 4], labelIds: [labels[0]!.id] });
    await api.tagRows({ rowIds: [1], note: 'note only' });

    expect(await api.findTaggedPosition(-1, 'next')).toBe(0);
    expect(await api.findTaggedPosition(1, 'next')).toBe(4);
    expect(await api.findTaggedPosition(4, 'next')).toBe(-1);
    expect(await api.findTaggedPosition(4, 'previous')).toBe(1);

    await api.applyFilter({ expression: paris });
    await api.applySorts({ sorts: [{ column: 'name', direction: 'desc' }] });
    // View: Erin(4), Carol(2), Alice(0)
    expect(await api.findTaggedPosition(0, 'next')).toBe(2);
    expect(await api.findTaggedPosition(2, 'previous')).toBe(0);
  });

  it('groupBy aggregates over the filtered and searched rows', async () => {
    const api = await loaded();
    const all = await api.groupBy({ groupBy: 'city', aggregations: [{ operator: 'count', alias: 'n' }] });
    expect(all.totalRows).toBe(5);
    expect(all.totalGroups).toBe(3);

    await api.applyFilter({ expression: { column: 'name', operator: 'neq', value: 'Alice' } });
    await api.globalSearch({ query: 'a', columns: ['city'] });
    const grouped = await api.groupBy({ groupBy: 'city', aggregations: [{ operator: 'count', alias: 'n' }] });
    expect(grouped.totalRows).toBe(2);
    // Alice is filtered out; London and Lisbon contain no "a".
    expect(grouped.rows).toEqual([{ key: 'Paris', rowCount: 2, aggregates: { n: 2 } }]);
  });

  it('a newer groupBy supersedes an in-flight one', async () => {
    const api = await loaded();
    const first = api.groupBy({ groupBy: 'city', aggregations: [] });
    const second = api.groupBy({ groupBy: 'name', aggregations: [] });
    await expect(first).rejects.toMatchObject({ name: 'StaleOperationError' });
    expect((await second).totalGroups).toBe(5);
  });

  it('profileColumn and getTimeHistogram use the filtered rows', async () => {
    const api = await loaded();
    await expect(api.profileColumn('missing')).rejects.toThrow('Unknown column');
    await api.applyFilter({ expression: paris });

    const profile = await api.profileColumn('name');
    expect(profile).toMatchObject({ column: 'name', rows: 3, emptyCount: 0, distinctCount: 3 });

    const histogram = await api.getTimeHistogram({ column: 'seen', buckets: 2 });
    expect(histogram.datedRows).toBe(3);
    expect(histogram.start).toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(histogram.counts).toEqual([2, 1]);

    expect(await api.getTimeHistogram({ column: 'missing', buckets: 2 })).toEqual({
      column: 'missing',
      start: null,
      bucketMs: 0,
      counts: [],
      datedRows: 0
    });
  });
});

describe('dataWorkerApi value distributions', () => {
  it('counts non-empty values sorted by frequency', async () => {
    const api = await loaded('city,id\nParis,1\nLondon,2\nParis,3\n,4\nParis,5\nLondon,6\n');
    expect(await api.getColumnValueDistribution({ column: 'city' })).toEqual({
      column: 'city',
      totalRows: 6,
      nonNullRows: 5,
      distinctCount: 2,
      skipped: false,
      items: [
        { value: 'Paris', count: 3 },
        { value: 'London', count: 2 }
      ]
    });
  });

  it('skips columns where distinct values exceed half the rows', async () => {
    const api = await loaded('name\nalpha\nbeta\ngamma\ndelta\nalpha\nzeta\n');
    const distribution = await api.getColumnValueDistribution({ column: 'name' });
    expect(distribution).toMatchObject({ skipped: true, distinctCount: 5, items: [], skipReason: 'Too many unique values' });
  });

  it('caches completed distributions', async () => {
    const api = await loaded('city\nParis\nLondon\nParis\n');
    const iterate = vi.spyOn(RowBatchStore.prototype, 'iterateBatches');
    const first = await api.getColumnValueDistribution({ column: 'city' });
    expect(await api.getColumnValueDistribution({ column: 'city' })).toEqual(first);
    expect(iterate).toHaveBeenCalledTimes(1);
  });

  it('does not cache partial distributions computed while loading', async () => {
    const api = createDataWorkerApi();
    const partial: ColumnValueDistributionResult[] = [];
    await api.loadFile(
      { handles: [createMockFileHandle('city\nParis\nParis\nLondon\nLondon\n')], batchSize: 2 },
      {
        onProgress: async () => {
          partial.push(await api.getColumnValueDistribution({ column: 'city' }));
        }
      }
    );
    expect(partial[0]!.items).toEqual([{ value: 'Paris', count: 2 }]);
    const complete = await api.getColumnValueDistribution({ column: 'city' });
    expect(complete.totalRows).toBe(4);
    expect(complete.items).toEqual([
      { value: 'London', count: 2 },
      { value: 'Paris', count: 2 }
    ]);
  });

  it('returns an empty distribution for unknown columns', async () => {
    const api = await loaded();
    expect(await api.getColumnValueDistribution({ column: 'nope' })).toMatchObject({ items: [], distinctCount: 0 });
  });
});

describe('dataWorkerApi exportCsv', () => {
  it('exports the current view and escapes formula-like cells', async () => {
    const api = await loaded();
    await api.applyFilter({ expression: paris });
    await api.applySorts({ sorts: [{ column: 'name', direction: 'desc' }] });
    const blob = await api.exportCsv({
      columns: [
        { key: 'name', header: 'Name' },
        { key: 'score', header: 'Score' }
      ],
      scope: 'view'
    });
    expect(blob.type).toContain('text/csv');
    expect(await blob.text()).toBe('"Name","Score"\n"Erin","\'=1+1"\n"Carol","20"\n"Alice","30"\n');
  });

  it('exports labelled rows in row order with label names and notes', async () => {
    const api = await loaded();
    const { labels } = await api.loadTags();
    const [first, second] = labels;
    await api.tagRows({ rowIds: [3], labelIds: [first!.id, second!.id], note: 'check' });
    await api.tagRows({ rowIds: [1], note: '-dangerous' });
    await api.applyFilter({ expression: paris });

    const blob = await api.exportCsv({ columns: [{ key: 'name', header: 'Name' }], scope: 'labelled' });
    expect(await blob.text()).toBe(
      `"Name","labels","note"\n"Bob","","'-dangerous"\n"Dave","${first!.name}; ${second!.name}","check"\n`
    );
  });
});
