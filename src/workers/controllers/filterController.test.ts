import { describe, expect, it, vi } from 'vitest';

import { createFilterController } from './filterController';
import { createDataWorkerState } from '../state/dataWorkerState';
import type { MaterializedRow } from '../utils/materializeRowBatch';
import type { FilterNode } from '../types';

describe('filterController', () => {
  it('returns all rows when no filter expression is provided', async () => {
    const state = createDataWorkerState();
    state.updateDataset((dataset) => {
      dataset.totalRows = 5;
    });
    const materializeViewWindow = vi
      .fn(async (_offset: number, _limit?: number) => [{ __rowId: 1 } as MaterializedRow]);

    const controller = createFilterController({
      state,
      materializeViewWindow
    });

    const result = await controller.run({ expression: null, offset: 0, limit: 10 });

    expect(materializeViewWindow).toHaveBeenCalledWith(0, 10);
    expect(result.rows).toHaveLength(1);
    expect(result.matchedRows).toBe(5);
    expect(state.dataset.filterExpression).toBeNull();
    expect(state.dataset.filterRowIds).toBeNull();
  });

  it('handles missing batch store gracefully when a filter is provided', async () => {
    const state = createDataWorkerState();
    state.updateDataset((dataset) => {
      dataset.totalRows = 3;
    });
    const materializeViewWindow = vi.fn(async () => []);
    const controller = createFilterController({
      state,
      materializeViewWindow
    });

    const result = await controller.run({
      expression: {} as FilterNode,
      offset: 0,
      limit: 5
    });

    expect(result.rows).toEqual([]);
    expect(result.matchedRows).toBe(0);
    expect(materializeViewWindow).not.toHaveBeenCalled();
  });
});
