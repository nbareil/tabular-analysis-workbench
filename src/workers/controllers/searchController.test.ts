import { describe, expect, it, vi } from 'vitest';

import { createSearchController } from './searchController';
import { createDataWorkerState } from '../state/dataWorkerState';
import type { MaterializedRow } from '../utils/materializeRowBatch';
import type { SearchRequest } from '../searchEngine';

const createBatchStore = () =>
  ({
    iterateMaterializedBatches: async function* iterateMaterializedBatches() {
      // No-op iterator for tests that only exercise blank-query paths
    }
  }) as any;

describe('searchController', () => {
  it('uses the view window when a blank query is supplied', async () => {
    const state = createDataWorkerState();
    state.updateDataset((dataset) => {
      dataset.batchStore = createBatchStore();
      dataset.totalRows = 10;
      dataset.columnTypes = { foo: 'string' } as Record<string, any>;
    });
    const materializeViewWindow = vi.fn().mockResolvedValue([
      { __rowId: 3 } as MaterializedRow,
      { __rowId: 4 } as MaterializedRow
    ]);

    const controller = createSearchController({
      state,
      materializeViewWindow
    });

    const request: SearchRequest = {
      query: '   ',
      columns: [],
      limit: 5,
      caseSensitive: false,
      filter: null
    };
    const result = await controller.run(request);

    expect(materializeViewWindow).toHaveBeenCalledWith(0, 5);
    expect(result.rows).toEqual([3, 4]);
    expect(result.totalRows).toBe(10);
  });

  it('returns an empty result when no dataset is loaded', async () => {
    const state = createDataWorkerState();
    const controller = createSearchController({
      state,
      materializeViewWindow: vi.fn()
    });

    const result = await controller.run({
      query: 'foo',
      columns: [],
      limit: 5,
      caseSensitive: false,
      filter: null
    });

    expect(result).toEqual({
      rows: [],
      totalRows: 0,
      matchedRows: 0
    });
  });
});
