import { evaluateFilterOnRows } from '../filterEngine';
import { startPerformanceMeasure } from '../utils/performanceMarks';
import type { DataWorkerStateController } from '../state/dataWorkerState';
import type { MaterializedRow } from '../utils/materializeRowBatch';
import type { ApplyFilterRequest, ApplyFilterResult } from '../workerApiTypes';

export interface FilterController {
  init(): void;
  clear(): void;
  run(request: ApplyFilterRequest): Promise<ApplyFilterResult>;
}

export interface FilterControllerDeps {
  state: DataWorkerStateController;
  materializeViewWindow: (offset: number, limit?: number) => Promise<MaterializedRow[]>;
}

export const createFilterController = ({
  state,
  materializeViewWindow
}: FilterControllerDeps): FilterController => {
  const init = (): void => {
    // No-op for now but kept for lifecycle symmetry
  };

  const clear = (): void => {
    state.updateDataset((dataset) => {
      dataset.filterExpression = null;
      dataset.filterRowIds = null;
      dataset.sortedRowIds = null;
    });
  };

  const run = async ({
    expression,
    offset = 0,
    limit
  }: ApplyFilterRequest): Promise<ApplyFilterResult> => {
    const filterMeasure = startPerformanceMeasure('worker-filter');
    try {
      state.updateDataset((dataset) => {
        dataset.filterExpression = expression;
        dataset.filterRowIds = null;
        dataset.sortedRowIds = null;
      });

      const totalRows = state.dataset.totalRows;
      if (!totalRows) {
        return { rows: [], totalRows: 0, matchedRows: 0, expression };
      }

      if (!expression) {
        const rows = await materializeViewWindow(offset, limit);
        return {
          rows,
          totalRows,
          matchedRows: totalRows,
          expression
        };
      }

      const batchStore = state.dataset.batchStore;
      if (!batchStore) {
        return {
          rows: [],
          totalRows,
          matchedRows: 0,
          expression
        };
      }

      const matchedRowIds: number[] = [];
      let fuzzyUsed: ApplyFilterResult['fuzzyUsed'];
      const predicateMatchCounts: Record<string, number> = {};

      for await (const { rowStart, rows } of batchStore.iterateMaterializedBatches()) {
        const result = evaluateFilterOnRows(
          rows,
          state.dataset.columnTypes,
          expression,
          {
            tags: state.tagging.tags,
            fuzzyIndex: state.dataset.fuzzyIndexSnapshot
          },
          {
            collectPredicateMatch: (predicateId, count) => {
              const current = predicateMatchCounts[predicateId] ?? 0;
              predicateMatchCounts[predicateId] = current + count;
            }
          }
        );

        for (let idx = 0; idx < result.matches.length; idx += 1) {
          if (result.matches[idx] === 1) {
            matchedRowIds.push(rowStart + idx);
          }
        }

        if (result.fuzzyUsed && !fuzzyUsed) {
          fuzzyUsed = result.fuzzyUsed;
        }
      }

      state.updateDataset((dataset) => {
        dataset.filterRowIds = Uint32Array.from(matchedRowIds);
      });

      const rows = await materializeViewWindow(offset, limit);
      return {
        rows,
        totalRows,
        matchedRows: matchedRowIds.length,
        expression,
        fuzzyUsed,
        predicateMatchCounts
      };
    } finally {
      filterMeasure?.();
    }
  };

  return {
    init,
    clear,
    run
  };
};
