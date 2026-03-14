import { normalizeValue } from '../utils/stringUtils';
import type { DataWorkerStateController } from '../state/dataWorkerState';
import type { MaterializedRow } from '../utils/materializeRowBatch';
import type { ClearSearchRequest, SearchRequest, GlobalSearchResult } from '../workerApiTypes';

export interface SearchController {
  init(): void;
  clear(): void;
  clearSearch(request?: ClearSearchRequest): void;
  run(request: SearchRequest): Promise<GlobalSearchResult>;
}

export interface SearchControllerDeps {
  state: DataWorkerStateController;
}

const SEARCH_CHUNK_SIZE = 10_000;

const rowMatchesQuery = ({
  row,
  columns,
  needle,
  caseSensitive
}: {
  row: MaterializedRow;
  columns: string[];
  needle: string;
  caseSensitive: boolean;
}): boolean =>
  columns.some((column) => normalizeValue(row[column], caseSensitive).includes(needle));

export const createSearchController = ({ state }: SearchControllerDeps): SearchController => {
  let latestRequestId = 0;

  const init = (): void => {
    // No-op hook for future instrumentation
  };

  const clearSearch = (request?: ClearSearchRequest): void => {
    const requestId =
      typeof request?.requestId === 'number' && Number.isFinite(request.requestId)
        ? request.requestId
        : null;
    if (requestId != null) {
      latestRequestId = Math.max(latestRequestId, requestId);
    }

    state.updateDataset((dataset) => {
      dataset.searchRowIds = null;
      dataset.sortedRowIds = null;
      dataset.backgroundSortPromise = null;
      dataset.sortComplete = true;
    });
  };

  const clear = (): void => {
    clearSearch();
  };

  const run = async (request: SearchRequest): Promise<GlobalSearchResult> => {
    const batchStore = state.dataset.batchStore;
    if (!batchStore) {
      return {
        totalRows: 0,
        matchedRows: 0
      };
    }

    const searchableColumns =
      request.columns.length > 0
        ? request.columns.filter((column) => state.dataset.columnTypes[column] != null)
        : Object.keys(state.dataset.columnTypes);
    const caseSensitive = Boolean(request.caseSensitive);
    const requestId =
      typeof request.requestId === 'number' && Number.isFinite(request.requestId)
        ? request.requestId
        : null;
    const trimmed = request.query.trim();

    if (requestId != null) {
      latestRequestId = Math.max(latestRequestId, requestId);
    }

    const baseRowIds = state.dataset.filterRowIds
      ? Array.from(state.dataset.filterRowIds)
      : null;
    const totalRows = baseRowIds ? baseRowIds.length : state.dataset.totalRows;

    if (!trimmed) {
      clearSearch();
      return {
        totalRows,
        matchedRows: 0
      };
    }

    if (totalRows === 0 || searchableColumns.length === 0) {
      if (requestId == null || requestId === latestRequestId) {
        state.updateDataset((dataset) => {
          dataset.searchRowIds = new Uint32Array(0);
          dataset.sortedRowIds = null;
          dataset.backgroundSortPromise = null;
          dataset.sortComplete = true;
        });
      }
      return {
        totalRows,
        matchedRows: 0
      };
    }

    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
    const matched: number[] = [];

    if (baseRowIds) {
      for (let start = 0; start < baseRowIds.length; start += SEARCH_CHUNK_SIZE) {
        const slice = baseRowIds.slice(start, start + SEARCH_CHUNK_SIZE);
        const rows = await batchStore.materializeRows(slice);

        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const rowId = slice[index];
          if (!row || rowId == null) {
            continue;
          }

          if (
            rowMatchesQuery({
              row,
              columns: searchableColumns,
              needle,
              caseSensitive
            })
          ) {
            matched.push(rowId);
          }
        }
      }
    } else {
      for await (const { rowStart, rows } of batchStore.iterateMaterializedBatches()) {
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          if (!row) {
            continue;
          }

          if (
            rowMatchesQuery({
              row,
              columns: searchableColumns,
              needle,
              caseSensitive
            })
          ) {
            matched.push(rowStart + index);
          }
        }
      }
    }

    if (requestId == null || requestId === latestRequestId) {
      state.updateDataset((dataset) => {
        dataset.searchRowIds = Uint32Array.from(matched);
        dataset.sortedRowIds = null;
        dataset.backgroundSortPromise = null;
        dataset.sortComplete = true;
      });
    }

    return {
      totalRows,
      matchedRows: matched.length
    };
  };

  return {
    init,
    clear,
    clearSearch,
    run
  };
};
