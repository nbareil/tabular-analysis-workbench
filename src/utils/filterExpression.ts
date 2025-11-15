import {
  TAG_COLUMN_ID,
  TAG_NO_LABEL_FILTER_VALUE,
  type FilterNode,
  type FilterPredicate
} from '@workers/types';
import type { FilterState } from '@state/sessionStore';

const clampFuzzyDistance = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }

  const rounded = Math.floor(value);
  if (rounded < 1) {
    return undefined;
  }

  return Math.min(3, rounded);
};

export const buildFilterExpression = (filters: FilterState[]): FilterNode | null => {
  const activeFilters = filters.filter((filter) => filter.enabled !== false);
  if (!activeFilters.length) {
    return null;
  }

  const predicates: FilterPredicate[] = activeFilters.map((predicate) => {
    const operator = predicate.operator as FilterPredicate['operator'];
    let value = predicate.value;
    let fuzzy = predicate.fuzzy;
    let fuzzyDistance: number | undefined;

    if (fuzzy === false && predicate.fuzzyExplicit !== true) {
      fuzzy = undefined;
    }

    if (predicate.column === TAG_COLUMN_ID) {
      if (value === TAG_NO_LABEL_FILTER_VALUE) {
        value = null;
      }
    }

    if (predicate.fuzzyDistanceExplicit && predicate.fuzzy !== false) {
      fuzzyDistance = clampFuzzyDistance(predicate.fuzzyDistance);
    }

    return {
      id: predicate.id,
      column: predicate.column,
      operator,
      value,
      value2: predicate.value2,
      caseSensitive: Boolean(predicate.caseSensitive),
      fuzzy,
      fuzzyDistance
    };
  });

  return {
    op: 'and',
    predicates
  };
};
