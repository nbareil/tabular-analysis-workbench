import { useCallback } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore, type FilterState } from '@state/sessionStore';
import { useUndoStore } from '@state/undoStore';
import { getDataWorker, isStaleOperation } from '@workers/dataWorkerProxy';
import { buildFilterExpression } from '@utils/filterExpression';
import { reportAppError } from '@utils/diagnostics';

export interface UseFilterSyncResult {
  filters: FilterState[];
  /** Applies filters; pass `{ undoable: false }` when replaying history so it is not recorded again. */
  applyFilters: (nextFilters: FilterState[], options?: { undoable?: boolean }) => Promise<void>;
}

/** Applies filters in the worker; the worker re-runs any active search and sort on the new rows. */
export const useFilterSync = (): UseFilterSyncResult => {
  const filters = useSessionStore((state) => state.filters);
  const setFilters = useSessionStore((state) => state.setFilters);
  const setFilterSummary = useDataStore((state) => state.setFilterSummary);
  const clearFilterSummary = useDataStore((state) => state.clearFilterSummary);
  const bumpViewVersion = useDataStore((state) => state.bumpViewVersion);

  const applyFilters = useCallback(
    async (nextFilters: FilterState[], { undoable = true }: { undoable?: boolean } = {}) => {
      if (undoable) {
        const before = useSessionStore.getState().filters;
        // Editing values of the same set of filters (typing) collapses into one undo step.
        const sameFilters = before.map((filter) => filter.id).join() === nextFilters.map((filter) => filter.id).join();
        useUndoStore
          .getState()
          .record({ kind: 'filters', before, after: nextFilters }, sameFilters ? `filters:${before.map((filter) => filter.id).join()}` : undefined);
      }
      setFilters(nextFilters);
      const expression = buildFilterExpression(nextFilters);
      try {
        const response = await getDataWorker().applyFilter({ expression });
        if (expression) {
          setFilterSummary({
            matchedRows: response.matchedRows,
            totalRows: response.totalRows,
            didYouMean: response.didYouMean,
            filterMatchCounts: response.predicateMatchCounts
          });
        } else {
          clearFilterSummary(response.matchedRows);
        }
        bumpViewVersion();
      } catch (error) {
        if (isStaleOperation(error)) {
          return;
        }
        reportAppError('Failed to apply filter', error, {
          operation: 'filters.apply',
          context: { filterCount: nextFilters.length },
          retry: () => applyFilters(nextFilters, { undoable: false })
        });
      }
    },
    [bumpViewVersion, clearFilterSummary, setFilterSummary, setFilters]
  );

  return { filters, applyFilters };
};
