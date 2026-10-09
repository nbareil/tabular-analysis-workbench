// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { activeRowOrder, createViewController, rowMaskFrom } from './viewController';
import { createIngestionPipeline } from './ingestionPipeline';
import { createDataWorkerState } from '../state/dataWorkerState';
import { createMockFileHandle } from '../test/mockFileHandle';
import type { FilterNode } from '../types';

const CSV = [
  'name,city,score',
  'Alice,Paris,30',
  'Bob,London,10',
  'Carol,Paris,20',
  'Dave,Lisbon,40',
  'Erin,Paris,5'
].join('\n');

const paris: FilterNode = { column: 'city', operator: 'eq', value: 'Paris' };

const setup = async (csv = CSV) => {
  const state = createDataWorkerState();
  await createIngestionPipeline(state).run({ handles: [createMockFileHandle(csv)], batchSize: 2 }, {});
  const view = createViewController(state);
  const names = async () => {
    const order = activeRowOrder(state.dataset) ?? Array.from({ length: state.dataset.totalRows }, (_, i) => i);
    return (await state.dataset.batchStore!.getRows(order)).map((row) => row.name);
  };
  return { state, view, names };
};

describe('rowMaskFrom', () => {
  it('returns null without row ids and a membership mask otherwise', () => {
    expect(rowMaskFrom(null, 3)).toBeNull();
    expect(Array.from(rowMaskFrom(Uint32Array.from([0, 2]), 3)!)).toEqual([1, 0, 1]);
  });
});

describe('viewController', () => {
  it('filters rows and reports predicate match counts', async () => {
    const { view, names } = await setup();
    const result = await view.applyFilter({ expression: { ...paris, id: 'p' } });
    expect(result).toMatchObject({ totalRows: 5, matchedRows: 3 });
    expect(result.predicateMatchCounts).toEqual({ p: 3 });
    expect(await names()).toEqual(['Alice', 'Carol', 'Erin']);
  });

  it('suggests did-you-mean values when a filter matches nothing', async () => {
    const { view } = await setup();
    const result = await view.applyFilter({ expression: { column: 'city', operator: 'eq', value: 'Pariss' } });
    expect(result.matchedRows).toBe(0);
    expect(result.didYouMean?.suggestions).toContain('Paris');
  });

  it('searches within the filtered rows', async () => {
    const { view, names } = await setup();
    await view.applyFilter({ expression: paris });
    const result = await view.search({ query: 'r', columns: ['name'] });
    expect(result).toEqual({ totalRows: 5, matchedRows: 2 });
    expect(await names()).toEqual(['Carol', 'Erin']);
  });

  it('honours case sensitivity and treats a blank query as no search', async () => {
    const { view, state } = await setup();
    expect((await view.search({ query: 'alice', columns: [], caseSensitive: true })).matchedRows).toBe(0);
    expect((await view.search({ query: 'alice', columns: [] })).matchedRows).toBe(1);
    expect(await view.search({ query: '   ', columns: [] })).toEqual({ totalRows: 5, matchedRows: 5 });
    expect(state.dataset.search).toBeNull();
    expect(state.dataset.searchRowIds).toBeNull();
  });

  it('sorts the searched rows numerically and keeps the sort when the search changes', async () => {
    const { view, names } = await setup();
    await view.search({ query: 'a', columns: ['name'] });
    const sorted = await view.applySorts({ sorts: [{ column: 'score', direction: 'asc' }] });
    expect(sorted.matchedRows).toBe(3);
    expect(await names()).toEqual(['Carol', 'Alice', 'Dave']);

    await view.search({ query: '', columns: [] });
    expect(await names()).toEqual(['Erin', 'Bob', 'Carol', 'Alice', 'Dave']);
  });

  it('drops sorts on unknown columns', async () => {
    const { view, state } = await setup();
    const result = await view.applySorts({
      sorts: [
        { column: 'missing', direction: 'asc' },
        { column: 'name', direction: 'desc' }
      ]
    });
    expect(result.sorts).toEqual([{ column: 'name', direction: 'desc' }]);
    expect(state.dataset.sorts).toEqual([{ column: 'name', direction: 'desc' }]);
  });

  it('recomputes the active search and sort when the filter changes', async () => {
    const { view, names } = await setup();
    await view.search({ query: 'e', columns: ['name'] });
    await view.applySorts({ sorts: [{ column: 'score', direction: 'desc' }] });
    expect(await names()).toEqual(['Dave', 'Alice', 'Erin']);

    const result = await view.applyFilter({ expression: paris });
    expect(result.matchedRows).toBe(2);
    expect(await names()).toEqual(['Alice', 'Erin']);

    const cleared = await view.applyFilter({ expression: null });
    expect(cleared.matchedRows).toBe(3);
    expect(await names()).toEqual(['Dave', 'Alice', 'Erin']);
  });

  it('rejects an invalid regex with FilterError and keeps the previous view', async () => {
    const { view, state, names } = await setup();
    await view.applyFilter({ expression: paris });
    await expect(
      view.applyFilter({ expression: { column: 'name', operator: 'regex', value: '(' } })
    ).rejects.toMatchObject({ name: 'FilterError' });
    expect(state.dataset.filterExpression).toEqual(paris);
    expect(await names()).toEqual(['Alice', 'Carol', 'Erin']);
  });

  it('a newer filter supersedes an in-flight filter', async () => {
    const { view, names } = await setup();
    const first = view.applyFilter({ expression: paris });
    const second = view.applyFilter({ expression: { column: 'city', operator: 'eq', value: 'London' } });
    await expect(first).rejects.toMatchObject({ name: 'StaleOperationError' });
    expect((await second).matchedRows).toBe(1);
    expect(await names()).toEqual(['Bob']);
  });

  it('a newer filter supersedes in-flight search and sort without them overwriting it', async () => {
    const { view, state, names } = await setup();
    const search = view.search({ query: 'Alice', columns: [] });
    const sort = view.applySorts({ sorts: [{ column: 'name', direction: 'desc' }] });
    const filter = view.applyFilter({ expression: paris });
    await expect(search).rejects.toMatchObject({ name: 'StaleOperationError' });
    await expect(sort).rejects.toMatchObject({ name: 'StaleOperationError' });
    expect((await filter).matchedRows).toBe(3);
    expect(state.dataset.search).toBeNull();
    expect(state.dataset.sorts).toEqual([]);
    expect(await names()).toEqual(['Alice', 'Carol', 'Erin']);
  });

  it('a newer search supersedes an in-flight sort', async () => {
    const { view } = await setup();
    const sort = view.applySorts({ sorts: [{ column: 'name', direction: 'desc' }] });
    const search = view.search({ query: 'Paris', columns: [] });
    await expect(sort).rejects.toMatchObject({ name: 'StaleOperationError' });
    expect((await search).matchedRows).toBe(3);
  });

  it('a sort requested right after a filter does not cancel the filter', async () => {
    const { view, names } = await setup();
    const filter = view.applyFilter({ expression: paris });
    const sort = view.applySorts({ sorts: [{ column: 'score', direction: 'asc' }] });
    expect((await filter).matchedRows).toBe(3);
    await sort;
    expect(await names()).toEqual(['Erin', 'Carol', 'Alice']);
  });

  it('a filter on a replaced dataset rejects without touching the new one', async () => {
    const { state, view } = await setup();
    const filter = view.applyFilter({ expression: paris });
    await createIngestionPipeline(state).run({ handles: [createMockFileHandle('city\nParis\nRome\n')] }, {});
    await expect(filter).rejects.toMatchObject({ name: 'StaleOperationError' });
    expect(state.dataset.filterRowIds).toBeNull();
    expect(state.dataset.totalRows).toBe(2);
  });

  it('returns empty results when no dataset is loaded', async () => {
    const view = createViewController(createDataWorkerState());
    expect(await view.applyFilter({ expression: paris })).toEqual({ totalRows: 0, matchedRows: 0 });
    expect(await view.search({ query: 'x', columns: [] })).toEqual({ totalRows: 0, matchedRows: 0 });
    expect(await view.applySorts({ sorts: [{ column: 'name', direction: 'asc' }] })).toEqual({
      totalRows: 0,
      matchedRows: 0,
      sorts: []
    });
  });
});
