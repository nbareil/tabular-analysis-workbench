import { sortRowIds, sortRowIdsProgressive } from '../sortEngine';
import type { DataWorkerStateController } from '../state/dataWorkerState';
import type { MaterializedRow } from '../utils/materializeRowBatch';
import type { ApplySortRequest, ApplySortResult } from '../workerApiTypes';

export interface SortController {
  init(): void;
  clear(): void;
  run(request: ApplySortRequest): Promise<ApplySortResult>;
}

export interface SortControllerDeps {
  state: DataWorkerStateController;
  materializeViewWindow: (offset: number, limit?: number) => Promise<MaterializedRow[]>;
  getActiveRowCount: () => number;
}

export const createSortController = ({
  state,
  materializeViewWindow,
  getActiveRowCount
}: SortControllerDeps): SortController => {
  const init = (): void => {
    // No-op placeholder for future lifecycle logic
  };

  const clear = (): void => {
    state.updateDataset((dataset) => {
      dataset.sorts = [];
      dataset.sortedRowIds = null;
      dataset.backgroundSortPromise = null;
      dataset.sortComplete = true;
    });
  };

  const run = async ({
    sorts,
    offset = 0,
    limit,
    progressive = false,
    visibleRows = 1000
  }: ApplySortRequest): Promise<ApplySortResult> => {
    const totalRows = state.dataset.totalRows;

    if (!totalRows) {
      state.updateDataset((dataset) => {
        dataset.sorts = [];
        dataset.sortedRowIds = null;
      });
      return { rows: [], totalRows: 0, matchedRows: 0, sorts: [] };
    }

    const batchStore = state.dataset.batchStore;
    if (!batchStore) {
      return { rows: [], totalRows: 0, matchedRows: 0, sorts: [] };
    }

    const validSorts = sorts.filter((sort) => state.dataset.columnTypes[sort.column] != null);
    state.updateDataset((dataset) => {
      dataset.sorts = validSorts;
      dataset.sortedRowIds = null;
    });

    if (!validSorts.length) {
      const rows = await materializeViewWindow(offset, limit);
      return {
        rows,
        totalRows,
        matchedRows: getActiveRowCount(),
        sorts: []
      };
    }

    const baseRowIds = state.dataset.filterRowIds
      ? Array.from(state.dataset.filterRowIds)
      : Array.from({ length: totalRows }, (_, index) => index);

    if (!baseRowIds.length) {
      return { rows: [], totalRows, matchedRows: 0, sorts: validSorts };
    }

    if (state.dataset.backgroundSortPromise) {
      state.updateDataset((dataset) => {
        dataset.backgroundSortPromise = null;
      });
    }

    let sortedRowIds: Uint32Array | undefined;
    let sortComplete = false;

    if (progressive && baseRowIds.length > visibleRows * 2) {
      const result = await sortRowIdsProgressive(
        batchStore,
        baseRowIds,
        state.dataset.columnTypes,
        validSorts,
        visibleRows
      );
      sortedRowIds = result.sortedRowIds;
      sortComplete = result.sortComplete;

      if (result.backgroundPromise) {
        state.updateDataset((dataset) => {
          dataset.backgroundSortPromise = result.backgroundPromise!.then(
            (completeSortedIds) => {
              state.updateDataset((inner) => {
                inner.sortedRowIds = completeSortedIds;
                inner.sortComplete = true;
                inner.backgroundSortPromise = null;
              });
              return completeSortedIds;
            }
          );
        });
      }

      state.updateDataset((dataset) => {
        dataset.sortComplete = sortComplete;
      });
    } else {
      sortedRowIds = await sortRowIds(batchStore, baseRowIds, state.dataset.columnTypes, validSorts);
      sortComplete = true;
      state.updateDataset((dataset) => {
        dataset.sortComplete = true;
        dataset.backgroundSortPromise = null;
      });
    }

    state.updateDataset((dataset) => {
      dataset.sortedRowIds = sortedRowIds ?? null;
    });

    const rows = await materializeViewWindow(offset, limit);
    return {
      rows,
      totalRows,
      matchedRows: baseRowIds.length,
      sorts: validSorts,
      sortComplete,
      sortedRowCount: sortComplete ? baseRowIds.length : visibleRows
    };
  };

  return {
    init,
    clear,
    run
  };
};
