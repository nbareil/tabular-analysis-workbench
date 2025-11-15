import { damerauLevenshtein } from '../utils/levenshtein';
import { normalizeValue } from '../utils/stringUtils';
import { evaluateFilterOnRows } from '../filterEngine';
import type { DataWorkerStateController } from '../state/dataWorkerState';
import type { MaterializedRow } from '../utils/materializeRowBatch';
import type { SearchRequest } from '../searchEngine';
import type { GlobalSearchResult } from '../workerApiTypes';

export interface SearchController {
  init(): void;
  clear(): void;
  run(request: SearchRequest): Promise<GlobalSearchResult>;
  fetchRowsByIds(rowIds: number[]): Promise<MaterializedRow[]>;
}

export interface SearchControllerDeps {
  state: DataWorkerStateController;
  materializeViewWindow: (offset: number, limit?: number) => Promise<MaterializedRow[]>;
}

export const createSearchController = ({
  state,
  materializeViewWindow
}: SearchControllerDeps): SearchController => {
  const init = (): void => {
    // No-op hook for future instrumentation
  };

  const clear = (): void => {
    // Search does not maintain its own state, but lifecycle parity helps future refactors
  };

  const run = async (request: SearchRequest): Promise<GlobalSearchResult> => {
    const batchStore = state.dataset.batchStore;
    if (!batchStore) {
      return {
        rows: [],
        totalRows: 0,
        matchedRows: 0
      };
    }

    const totalRows = state.dataset.totalRows;
    if (!totalRows) {
      return {
        rows: [],
        totalRows: 0,
        matchedRows: 0
      };
    }

    const limit = typeof request.limit === 'number' ? Math.max(1, request.limit) : 500;
    const caseSensitive = Boolean(request.caseSensitive);
    const trimmed = request.query.trim();
    const columns =
      request.columns.length > 0
        ? request.columns.filter((column) => state.dataset.columnTypes[column] != null)
        : Object.keys(state.dataset.columnTypes);

    if (!trimmed) {
      const rows = await materializeViewWindow(0, limit);
      return {
        rows: rows.map((row) => row.__rowId),
        totalRows,
        matchedRows: rows.length
      };
    }

    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
    const matched: number[] = [];

    for await (const { rowStart, rows } of batchStore.iterateMaterializedBatches()) {
      let filterMatches: Uint8Array | null = null;
      if (request.filter) {
        filterMatches = evaluateFilterOnRows(rows, state.dataset.columnTypes, request.filter, {
          tags: state.tagging.tags,
          fuzzyIndex: state.dataset.fuzzyIndexSnapshot
        }).matches;
      }

      for (let idx = 0; idx < rows.length; idx += 1) {
        if (filterMatches && filterMatches[idx] !== 1) {
          continue;
        }

        const row = rows[idx]!;
        const found = columns.some((column) => {
          const value = normalizeValue(row[column], caseSensitive);
          if (value.includes(needle)) {
            return true;
          }
          if (needle.length <= 10) {
            const distance = damerauLevenshtein(value, needle, 2);
            if (distance <= 2) {
              return true;
            }
          }
          return false;
        });

        if (found) {
          matched.push(rowStart + idx);
          if (matched.length >= limit) {
            return {
              rows: matched,
              totalRows,
              matchedRows: matched.length
            };
          }
        }
      }
    }

    return {
      rows: matched,
      totalRows,
      matchedRows: matched.length
    };
  };

  const fetchRowsByIds = async (rowIds: number[]): Promise<MaterializedRow[]> => {
    if (!state.dataset.batchStore) {
      return [];
    }
    const uniqueIds = Array.from(new Set(rowIds)).sort((a, b) => a - b);
    const rows = await state.dataset.batchStore.materializeRows(uniqueIds);
    const idToRow = new Map<number, MaterializedRow>();
    uniqueIds.forEach((id, index) => {
      idToRow.set(id, rows[index]!);
    });
    return rowIds.map((id) => idToRow.get(id)).filter((row): row is MaterializedRow => row != null);
  };

  return {
    init,
    clear,
    run,
    fetchRowsByIds
  };
};
