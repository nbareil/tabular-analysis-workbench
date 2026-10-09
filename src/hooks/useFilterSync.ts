import { useDataStore } from '@state/dataStore';
import { useSessionStore, type FilterState } from '@state/sessionStore';
import { useUndoStore } from '@state/undoStore';
import { getDataWorker, isStaleOperation } from '@workers/dataWorkerProxy';
import { buildFilterExpression } from '@utils/filterExpression';
import { reportAppError } from '@utils/diagnostics';

/**
 * Applies filters in the worker; the worker re-runs any active search and sort on the new rows.
 * Pass `{ undoable: false }` when replaying history so the change is not recorded again.
 */
export const applyFilters = async (
  nextFilters: FilterState[],
  { undoable = true }: { undoable?: boolean } = {}
): Promise<void> => {
  const before = useSessionStore.getState().filters;
  if (undoable) {
    // Editing values of the same set of filters (typing) collapses into one undo step.
    const ids = before.map((filter) => filter.id).join();
    const sameFilters = ids === nextFilters.map((filter) => filter.id).join();
    useUndoStore.getState().record({ kind: 'filters', before, after: nextFilters }, sameFilters ? `filters:${ids}` : undefined);
  }
  useSessionStore.getState().setFilters(nextFilters);

  const expression = buildFilterExpression(nextFilters);
  const data = useDataStore.getState();
  try {
    const response = await getDataWorker().applyFilter({ expression });
    if (expression) {
      data.setFilterSummary({
        matchedRows: response.matchedRows,
        totalRows: response.totalRows,
        didYouMean: response.didYouMean,
        filterMatchCounts: response.predicateMatchCounts
      });
    } else {
      data.clearFilterSummary(response.matchedRows);
    }
    data.bumpViewVersion();
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
};

export interface UseFilterSyncResult {
  filters: FilterState[];
  applyFilters: typeof applyFilters;
}

export const useFilterSync = (): UseFilterSyncResult => ({
  filters: useSessionStore((state) => state.filters),
  applyFilters
});
