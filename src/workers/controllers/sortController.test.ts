import { describe, expect, it, vi } from 'vitest';

import { createSortController } from './sortController';
import { createDataWorkerState } from '../state/dataWorkerState';
import type { SortDefinition } from '../types';

describe('sortController', () => {
  it('returns unsorted rows when there are no totals to process', async () => {
    const state = createDataWorkerState();
    const materializeViewWindow = vi.fn().mockResolvedValue([]);
    const controller = createSortController({
      state,
      materializeViewWindow,
      getActiveRowCount: () => 0
    });

    const result = await controller.run({
      sorts: [],
      offset: 0,
      limit: 10
    });

    expect(result.rows).toEqual([]);
    expect(result.matchedRows).toBe(0);
    expect(state.dataset.sorts).toEqual([]);
  });

  it('handles missing batch store gracefully', async () => {
    const state = createDataWorkerState();
    state.updateDataset((dataset) => {
      dataset.totalRows = 5;
    });
    const materializeViewWindow = vi.fn().mockResolvedValue([]);
    const controller = createSortController({
      state,
      materializeViewWindow,
      getActiveRowCount: () => 0
    });

    const result = await controller.run({
      sorts: [{ column: 'foo', direction: 'asc' } as SortDefinition],
      offset: 0,
      limit: 10
    });

    expect(result.rows).toEqual([]);
    expect(result.matchedRows).toBe(0);
  });

  it('clear() resets existing sort metadata', () => {
    const state = createDataWorkerState();
    state.updateDataset((dataset) => {
      dataset.sorts = [
        {
          column: 'foo',
          direction: 'asc'
        } as SortDefinition
      ];
      dataset.sortedRowIds = new Uint32Array([0, 1]);
      dataset.sortComplete = false;
    });

    const controller = createSortController({
      state,
      materializeViewWindow: vi.fn(),
      getActiveRowCount: () => 0
    });

    controller.clear();

    expect(state.dataset.sorts).toEqual([]);
    expect(state.dataset.sortedRowIds).toBeNull();
    expect(state.dataset.sortComplete).toBe(true);
  });
});
