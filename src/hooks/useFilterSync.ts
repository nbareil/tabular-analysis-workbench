import { useCallback } from 'react';

import { useDataStore, type GridRow } from '@state/dataStore';
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

      try {
        const worker = getDataWorker();

        if (nextFilters.length === 0) {
          await worker.applyFilter({
            expression: null,
            offset: 0,
            limit: 500
          });
          clearFilterResult();
          clearSearchResult();
          return;
        }

        const expression = buildFilterExpression(nextFilters);

        if (!expression) {
          await worker.applyFilter({
            expression: null,
            offset: 0,
            limit: 500
          });
          clearFilterResult();
          clearSearchResult();
          return;
        }

        const request: ApplyFilterRequest = {
          expression,
          offset: 0,
          limit: 500
        };

        const response = await worker.applyFilter(request);
        setFilterResult({
          rows: response.rows as GridRow[],
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
