import { useCallback, useEffect, useMemo } from 'react';

import { useDataStore } from '@state/dataStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import type { FilterState } from '@/state/sessionStore';
import type { FuzzyMatchInfo } from '@workers/filterEngine';

const normaliseValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value ?? '');
};

const filterMatchesContext = (filter: FilterState, fuzzyUsed: FuzzyMatchInfo): boolean => {
  if (filter.enabled === false) {
    return false;
  }
  return (
    filter.column === fuzzyUsed.column &&
    filter.operator === fuzzyUsed.operator &&
    normaliseValue(filter.value) === fuzzyUsed.query
  );
};

const DISTANCE_OPTIONS = [1, 2, 3] as const;

export const FuzzyBanner = (): JSX.Element | null => {
  const fuzzyUsed = useDataStore((state) => state.fuzzyUsed);
  const columns = useDataStore((state) => state.columns);
  const { filters, applyFilters } = useFilterSync();

  const matchingFilter = useMemo(() => {
    if (!fuzzyUsed) {
      return undefined;
    }
    return filters.find((filter) => filterMatchesContext(filter, fuzzyUsed));
  }, [filters, fuzzyUsed]);

  const reapplyMatchingFilter = useCallback(
    (updater: (filter: FilterState) => FilterState | null) => {
      if (!fuzzyUsed || !matchingFilter) {
        return;
      }
      let changed = false;
      const nextFilters = filters.map((filter) => {
        if (!filterMatchesContext(filter, fuzzyUsed)) {
          return filter;
        }
        const next = updater(filter);
        if (!next) {
          return filter;
        }
        changed = true;
        return next;
      });
      if (changed) {
        void applyFilters(nextFilters);
      }
    },
    [applyFilters, filters, fuzzyUsed, matchingFilter]
  );

  const handleBackToExact = useCallback(() => {
    reapplyMatchingFilter((filter) => {
      if (filter.fuzzy === false) {
        return null;
      }
      return {
        ...filter,
        fuzzy: false,
        fuzzyExplicit: true
      };
    });
  }, [reapplyMatchingFilter]);

  const handleDistanceChange = useCallback(
    (distance: number) => {
      reapplyMatchingFilter((filter) => {
        if (filter.fuzzyDistanceExplicit === true && filter.fuzzyDistance === distance && filter.fuzzy === true) {
          return null;
        }
        return {
          ...filter,
          fuzzy: true,
          fuzzyExplicit: true,
          fuzzyDistance: distance,
          fuzzyDistanceExplicit: true
        };
      });
    },
    [reapplyMatchingFilter]
  );

  const handleToggleFuzzy = useCallback(() => {
    if (!matchingFilter) {
      return;
    }
    if (matchingFilter.fuzzy !== false) {
      handleBackToExact();
      return;
    }
    const fallbackDistance =
      (matchingFilter.fuzzyDistanceExplicit ? matchingFilter.fuzzyDistance : undefined) ??
      fuzzyUsed?.maxDistance ??
      1;
    handleDistanceChange(fallbackDistance);
  }, [handleBackToExact, handleDistanceChange, matchingFilter, fuzzyUsed]);

  useEffect(() => {
    if (!fuzzyUsed) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && (event.code === 'Backquote' || event.key === '~')) {
        event.preventDefault();
        handleToggleFuzzy();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fuzzyUsed, handleToggleFuzzy]);

  if (!fuzzyUsed) {
    return null;
  }

  const columnLabel =
    columns.find((column) => column.key === fuzzyUsed.column)?.headerName ?? fuzzyUsed.column;
  const selectedDistance =
    (matchingFilter?.fuzzyDistanceExplicit ? matchingFilter?.fuzzyDistance : undefined) ??
    fuzzyUsed.maxDistance;
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
              No exact matches for <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/60">'{fuzzyUsed.query}'</code> in{' '}
              <strong>{columnLabel}</strong>. Showing fuzzy matches (≤ {selectedDistance} edits).
            </p>
            {fuzzyUsed.suggestions.length > 0 && (
              <p className="text-xs text-yellow-800 dark:text-yellow-200">
                Did you mean{' '}
                {fuzzyUsed.suggestions.map((suggestion, index) => (
                  <span key={suggestion}>
                    <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/60">{suggestion}</code>
                    {index < fuzzyUsed.suggestions.length - 1 ? ', ' : ''}
                  </span>
                ))}{' '}
                ?
              </p>
            )}
            <p className="text-xs text-yellow-700 dark:text-yellow-300">Press Alt + ~ to toggle fuzzy mode quickly.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {DISTANCE_OPTIONS.map((distance) => {
              const isActive = distance === selectedDistance;
              return (
                <button
                  key={distance}
                  type="button"
                  onClick={() => handleDistanceChange(distance)}
                  disabled={controlsDisabled}
                  aria-pressed={isActive}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    isActive
                      ? 'border-yellow-600 bg-yellow-600 text-white'
                      : 'border-yellow-400 text-yellow-800 hover:bg-yellow-200 disabled:opacity-50 dark:text-yellow-100'
                  }`}
                >
                  ≤ {distance}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleBackToExact}
            disabled={controlsDisabled}
            className="rounded border border-yellow-600 px-3 py-1 text-xs font-semibold text-yellow-800 hover:bg-yellow-200 disabled:opacity-50 dark:text-yellow-100"
          >
            Back to exact
          </button>
        </div>
      </div>
    </div>
  );
};
