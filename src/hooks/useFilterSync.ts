import { useCallback, useEffect, useRef } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore, type FilterState } from '@state/sessionStore';
import { getDataWorker, type ApplyFilterRequest } from '@workers/dataWorkerProxy';
import { buildFilterExpression } from '@utils/filterExpression';
import { reportAppError } from '@utils/diagnostics';
import { logDebug } from '@utils/debugLog';

export interface UseFilterSyncResult {
  filters: FilterState[];
  applyFilters: (nextFilters: FilterState[]) => Promise<void>;
}

interface UseFilterSyncOptions {
  bootstrap?: boolean;
}

export const useFilterSync = (
  options: UseFilterSyncOptions = {}
): UseFilterSyncResult => {
  const { bootstrap = false } = options;
  const filters = useSessionStore((state) => state.filters);
  const setFilters = useSessionStore((state) => state.setFilters);
  const setFilterSummary = useDataStore((state) => state.setFilterSummary);
  const setDidYouMean = useDataStore((state) => state.setDidYouMean);
  const clearFilterSummary = useDataStore((state) => state.clearFilterSummary);
  const setMatchedRowCount = useDataStore((state) => state.setMatchedRowCount);
  const bumpViewVersion = useDataStore((state) => state.bumpViewVersion);
  const clearSearchResult = useDataStore((state) => state.clearSearchResult);
  const loaderStatus = useDataStore((state) => state.status);
  const totalRows = useDataStore((state) => state.totalRows);
  const bootstrapAppliedRef = useRef(false);
  const requestIdRef = useRef(0);

  const applyFilters = useCallback(
    async (nextFilters: FilterState[]) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      let filtersToApply = nextFilters;
      setFilters(filtersToApply);

      try {
        if (import.meta.env.DEV) {
          logDebug('filters', 'applyFilters requested', {
            filterCount: filtersToApply.length,
            filters: filtersToApply.map((filter) => ({
              id: filter.id,
              column: filter.column,
              operator: filter.operator,
              enabled: filter.enabled !== false,
              value: filter.value,
              value2: filter.value2
            }))
          });
        }

        const worker = getDataWorker();

        const expression = buildFilterExpression(filtersToApply);

        if (!expression) {
          const response = await worker.applyFilter({
            expression: null,
            offset: 0,
            limit: 0
          });
          if (requestId !== requestIdRef.current) {
            return;
          }
          if (import.meta.env.DEV) {
            logDebug('filters', 'applyFilters cleared expression', {
              totalRows: response.totalRows
            });
          }
          clearFilterSummary();
          clearSearchResult();
          setMatchedRowCount(response.totalRows);
          setDidYouMean(null);
          bumpViewVersion();
          return;
        }

        const request: ApplyFilterRequest = {
          expression,
          offset: 0,
          limit: 0
        };

        const response = await worker.applyFilter(request);
        if (requestId !== requestIdRef.current) {
          return;
        }

        if (import.meta.env.DEV) {
          logDebug('filters', 'applyFilters response', {
            matchedRows: response.matchedRows,
            totalRows: response.totalRows,
            didYouMean: response.didYouMean ?? null,
            predicateMatchCounts: response.predicateMatchCounts ?? null
          });
        }

        setFilterSummary({
          matchedRows: response.matchedRows,
          totalRows: response.totalRows,
          didYouMean: response.didYouMean,
          filterMatchCounts: response.predicateMatchCounts ?? undefined
        });
        clearSearchResult();
        setMatchedRowCount(response.matchedRows);
        setDidYouMean(response.didYouMean ?? null);
        bumpViewVersion();
      } catch (error) {
        console.error('Failed to apply filter', error);
        reportAppError('Failed to apply filter', error, {
          operation: 'filters.apply',
          context: { filterCount: filtersToApply.length },
          retry: () => applyFilters(filtersToApply)
        });
      }
    },
    [setFilters, clearFilterSummary, clearSearchResult, setFilterSummary, setMatchedRowCount, setDidYouMean, bumpViewVersion]
  );

  useEffect(() => {
    if (!bootstrap) {
      bootstrapAppliedRef.current = false;
      return;
    }

    if (loaderStatus !== 'ready' || totalRows === 0) {
      if (import.meta.env.DEV && filters.length > 0) {
        logDebug('filters', 'bootstrap deferred', {
          loaderStatus,
          totalRows,
          filterCount: filters.length
        });
      }
      bootstrapAppliedRef.current = false;
      return;
    }

    if (!filters.length) {
      bootstrapAppliedRef.current = false;
      return;
    }

    if (bootstrapAppliedRef.current) {
      return;
    }

    bootstrapAppliedRef.current = true;
    if (import.meta.env.DEV) {
      logDebug('filters', 'bootstrapping persisted filters', {
        totalRows,
        filterCount: filters.length
      });
    }
    void applyFilters(filters);
  }, [applyFilters, bootstrap, filters, loaderStatus, totalRows]);

  return { filters, applyFilters };
};
