import { useCallback, useEffect, useRef } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore, type FilterState } from '@state/sessionStore';
import { getDataWorker, type ApplyFilterRequest } from '@workers/dataWorkerProxy';
import { buildFilterExpression } from '@utils/filterExpression';
import type { FuzzyMatchInfo } from '@workers/filterEngine';

export interface UseFilterSyncResult {
  filters: FilterState[];
  applyFilters: (nextFilters: FilterState[]) => Promise<void>;
}

const normaliseFilterValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value ?? '');
};

const applyAutoFuzzyFlag = (
  filters: FilterState[],
  fuzzyUsed: FuzzyMatchInfo | null | undefined
): { filters: FilterState[]; changed: boolean } => {
  if (!fuzzyUsed) {
    return { filters, changed: false };
  }

  let changed = false;
  const updated = filters.map((filter) => {
    if (filter.enabled === false) {
      return filter;
    }
    const matchesFilter =
      filter.column === fuzzyUsed.column &&
      filter.operator === fuzzyUsed.operator &&
      normaliseFilterValue(filter.value) === fuzzyUsed.query;

    if (
      !matchesFilter ||
      filter.fuzzy === true ||
      (filter.fuzzy === false && filter.fuzzyExplicit === true)
    ) {
      return filter;
    }

    changed = true;
    const nextFilter: FilterState = {
      ...filter,
      fuzzy: true,
      fuzzyExplicit: filter.fuzzyExplicit ?? false,
      fuzzyDistanceExplicit: false
    };
    if (typeof fuzzyUsed.maxDistance === 'number') {
      nextFilter.fuzzyDistance = fuzzyUsed.maxDistance;
    }
    return nextFilter;
  });

  return changed ? { filters: updated, changed: true } : { filters, changed: false };
};

export const useFilterSync = (): UseFilterSyncResult => {
  const filters = useSessionStore((state) => state.filters);
  const setFilters = useSessionStore((state) => state.setFilters);
  const setFilterSummary = useDataStore((state) => state.setFilterSummary);
  const setFuzzyUsed = useDataStore((state) => state.setFuzzyUsed);
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
        if (requestId !== requestIdRef.current) {
          return;
        }

        const { filters: maybeUpdated, changed } = applyAutoFuzzyFlag(
          filtersToApply,
          response.fuzzyUsed
        );
        if (changed) {
          filtersToApply = maybeUpdated;
          setFilters(maybeUpdated);
        }

        setFilterSummary({
          matchedRows: response.matchedRows,
          totalRows: response.totalRows,
          fuzzyUsed: response.fuzzyUsed,
          filterMatchCounts: response.predicateMatchCounts ?? undefined
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

  useEffect(() => {
    if (loaderStatus !== 'ready' || totalRows === 0) {
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
    void applyFilters(filters);
  }, [applyFilters, filters, loaderStatus, totalRows]);

  return { filters, applyFilters };
};
