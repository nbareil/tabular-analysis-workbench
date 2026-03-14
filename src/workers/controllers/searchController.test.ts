import { describe, expect, it, vi } from 'vitest';

import { createSearchController } from './searchController';
import { createDataWorkerState } from '../state/dataWorkerState';
import type { SearchRequest } from '../workerApiTypes';

describe('searchController', () => {
  it('returns an empty result when no dataset is loaded', async () => {
    const state = createDataWorkerState();
    const controller = createSearchController({ state });

    const result = await controller.run({
      query: 'foo',
      columns: [],
      caseSensitive: false
    });

    expect(result).toEqual({
      totalRows: 0,
      matchedRows: 0
    });
  });

  it('reuses filtered row ids when performing a search', async () => {
    const materializeRows = vi.fn(async (rowIds: number[]) =>
      rowIds.map((rowId) => ({
        __rowId: rowId,
        message: rowId === 1 ? 'alpha event' : 'beta event'
      }))
    );

    const state = createDataWorkerState();
    state.updateDataset((dataset) => {
      dataset.batchStore = {
        materializeRows,
        iterateMaterializedBatches: async function* () {
          throw new Error('iterateMaterializedBatches should not be used for filtered search');
        }
      } as any;
      dataset.totalRows = 4;
      dataset.columnTypes = { message: 'string' } as Record<string, any>;
      dataset.filterRowIds = Uint32Array.from([1, 3]);
    });

    const controller = createSearchController({ state });
    const request: SearchRequest = {
      query: 'alpha',
      columns: ['message'],
      caseSensitive: false
    };

    const result = await controller.run(request);

    expect(materializeRows).toHaveBeenCalledWith([1, 3]);
    expect(result).toEqual({
      totalRows: 2,
      matchedRows: 1
    });
    expect(Array.from(state.dataset.searchRowIds ?? [])).toEqual([1]);
  });

  it('ignores stale search requests when a newer clear request wins the race', async () => {
    let resolveRows: ((rows: Array<{ __rowId: number; message: string }>) => void) | null = null;
    const materializeRows = vi.fn(
      () =>
        new Promise<Array<{ __rowId: number; message: string }>>((resolve) => {
          resolveRows = resolve;
        })
    );

    const state = createDataWorkerState();
    state.updateDataset((dataset) => {
      dataset.batchStore = {
        materializeRows,
        iterateMaterializedBatches: async function* () {
          // unused in this test
        }
      } as any;
      dataset.totalRows = 2;
      dataset.columnTypes = { message: 'string' } as Record<string, any>;
      dataset.filterRowIds = Uint32Array.from([0, 1]);
    });

    const controller = createSearchController({ state });
    const pendingSearch = controller.run({
      requestId: 1,
      query: 'alpha',
      columns: ['message'],
      caseSensitive: false
    });

    controller.clearSearch({ requestId: 2 });
    const pendingResolver = resolveRows as
      | ((rows: Array<{ __rowId: number; message: string }>) => void)
      | null;
    if (!pendingResolver) {
      throw new Error('Expected search materialization to be pending');
    }
    pendingResolver([
      { __rowId: 0, message: 'alpha' },
      { __rowId: 1, message: 'alpha' }
    ]);

    const result = await pendingSearch;

    expect(result).toEqual({
      totalRows: 2,
      matchedRows: 2
    });
    expect(state.dataset.searchRowIds).toBeNull();
  });
});
