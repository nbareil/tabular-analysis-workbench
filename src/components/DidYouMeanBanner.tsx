import { useCallback, useMemo } from 'react';

import { useDataStore } from '@state/dataStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import type { FilterState } from '@/state/sessionStore';
import type { DidYouMeanInfo } from '@workers/filterEngine';

const normaliseValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value ?? '');
};

const filterMatchesContext = (filter: FilterState, didYouMean: DidYouMeanInfo): boolean => {
  if (filter.enabled === false) {
    return false;
  }
  return (
    filter.column === didYouMean.column &&
    filter.operator === didYouMean.operator &&
    normaliseValue(filter.value) === didYouMean.query
  );
};

export const DidYouMeanBanner = (): JSX.Element | null => {
  const didYouMean = useDataStore((state) => state.didYouMean);
  const columns = useDataStore((state) => state.columns);
  const { filters, applyFilters } = useFilterSync();

  const matchingFilter = useMemo(() => {
    if (!didYouMean || didYouMean.suggestions.length === 0) {
      return undefined;
    }
    return filters.find((filter) => filterMatchesContext(filter, didYouMean));
  }, [didYouMean, filters]);

  const handleApplySuggestion = useCallback(
    (suggestion: string) => {
      if (!didYouMean || !matchingFilter) {
        return;
      }

      const nextFilters = filters.map((filter) => {
        if (!filterMatchesContext(filter, didYouMean)) {
          return filter;
        }

        const nextFilter: FilterState = {
          ...filter,
          value: suggestion,
          enabled: true
        };
        delete nextFilter.fuzzy;
        delete nextFilter.fuzzyExplicit;
        delete nextFilter.fuzzyDistance;
        delete nextFilter.fuzzyDistanceExplicit;
        return nextFilter;
      });

      void applyFilters(nextFilters);
    },
    [applyFilters, didYouMean, filters, matchingFilter]
  );

  if (!didYouMean || didYouMean.suggestions.length === 0) {
    return null;
  }

  const columnLabel =
    columns.find((column) => column.key === didYouMean.column)?.headerName ?? didYouMean.column;
  const controlsDisabled = !matchingFilter;

  return (
    <div className="mb-4 rounded border border-yellow-500/40 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 shadow-inner dark:border-yellow-500/40 dark:bg-yellow-950/40 dark:text-yellow-100">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-1 items-start gap-3">
          <div className="mt-0.5 text-yellow-500">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="space-y-1">
            <p>
              No exact matches for <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/60">'{didYouMean.query}'</code> in{' '}
              <strong>{columnLabel}</strong>.
            </p>
            <p className="text-xs text-yellow-800 dark:text-yellow-200">
              Did you mean one of these exact values?
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {didYouMean.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => handleApplySuggestion(suggestion)}
              disabled={controlsDisabled}
              className="rounded-full border border-yellow-500 bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-900 transition hover:bg-yellow-200 disabled:opacity-50 dark:border-yellow-500/60 dark:bg-yellow-900/50 dark:text-yellow-100"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
