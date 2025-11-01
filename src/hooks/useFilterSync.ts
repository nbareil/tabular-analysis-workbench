import { useCallback } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore, type FilterState } from '@state/sessionStore';
import { getDataWorker, type ApplyFilterRequest } from '@workers/dataWorkerProxy';
import { buildFilterExpression } from '@utils/filterExpression';

export interface UseFilterSyncResult {
  filters: FilterState[];
  applyFilters: (nextFilters: FilterState[]) => Promise<void>;
}

export const useFilterSync = (): UseFilterSyncResult => {
  const filters = useSessionStore((state) => state.filters);
  const setFilters = useSessionStore((state) => state.setFilters);
  const setFilterResult = useDataStore((state) => state.setFilterResult);
  const clearFilterResult = useDataStore((state) => state.clearFilterResult);
  const clearSearchResult = useDataStore((state) => state.clearSearchResult);

  const applyFilters = useCallback(
    async (nextFilters: FilterState[]) => {
      setFilters(nextFilters);

      if (nextFilters.length === 0) {
        clearFilterResult();
        clearSearchResult();
        return;
      }

      const expression = buildFilterExpression(nextFilters);

      if (!expression) {
        clearFilterResult();
        clearSearchResult();
        return;
      }

      const request: ApplyFilterRequest = {
        expression,
        offset: 0,
        limit: 500
      };

      try {
        const worker = getDataWorker();
        const response = await worker.applyFilter(request);
        setFilterResult({
          rows: response.rows,
          totalRows: response.totalRows,
          matchedRows: response.matchedRows
        });
        clearSearchResult();
      } catch (error) {
        console.error('Failed to apply filter', error);
      }
    },
    [setFilters, clearFilterResult, clearSearchResult, setFilterResult]
  );

  return { filters, applyFilters };
};
