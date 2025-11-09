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
  const setFilterSummary = useDataStore((state) => state.setFilterSummary);
  const setFuzzyUsed = useDataStore((state) => state.setFuzzyUsed);
  const clearFilterSummary = useDataStore((state) => state.clearFilterSummary);
  const setMatchedRowCount = useDataStore((state) => state.setMatchedRowCount);
  const bumpViewVersion = useDataStore((state) => state.bumpViewVersion);
  const clearSearchResult = useDataStore((state) => state.clearSearchResult);

  const applyFilters = useCallback(
    async (nextFilters: FilterState[]) => {
      setFilters(nextFilters);

      try {
        const worker = getDataWorker();

        if (nextFilters.length === 0) {
          const response = await worker.applyFilter({
          expression: null,
          offset: 0,
          limit: 0
          });
          clearFilterSummary();
          clearSearchResult();
          setMatchedRowCount(response.totalRows);
          setFuzzyUsed(null);
          bumpViewVersion();
          return;
        }

        const expression = buildFilterExpression(nextFilters);

        if (!expression) {
          const response = await worker.applyFilter({
          expression: null,
          offset: 0,
          limit: 0
          });
          clearFilterSummary();
          clearSearchResult();
          setMatchedRowCount(response.totalRows);
          setFuzzyUsed(null);
          bumpViewVersion();
          return;
        }

        const request: ApplyFilterRequest = {
          expression,
          offset: 0,
          limit: 0
        };

        const response = await worker.applyFilter(request);
        setFilterSummary({
        matchedRows: response.matchedRows,
        totalRows: response.totalRows,
          fuzzyUsed: response.fuzzyUsed
        });
        clearSearchResult();
        setMatchedRowCount(response.matchedRows);
        setFuzzyUsed(response.fuzzyUsed ?? null);
        bumpViewVersion();
      } catch (error) {
        console.error('Failed to apply filter', error);
      }
    },
    [setFilters, clearFilterSummary, clearSearchResult, setFilterSummary, setMatchedRowCount, setFuzzyUsed, bumpViewVersion]
  );

  return { filters, applyFilters };
};
