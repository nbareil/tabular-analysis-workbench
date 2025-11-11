import {
  TAG_COLUMN_ID,
  TAG_NO_LABEL_FILTER_VALUE,
  type FilterNode,
  type FilterPredicate
} from '@workers/types';
import type { FilterState } from '@state/sessionStore';

export const buildFilterExpression = (filters: FilterState[]): FilterNode | null => {
  const activeFilters = filters.filter((filter) => filter.enabled !== false);
  if (!activeFilters.length) {
    return null;
  }

  const predicates: FilterPredicate[] = activeFilters.map((predicate) => {
    const operator = predicate.operator as FilterPredicate['operator'];
    let value = predicate.value;
    let fuzzy = predicate.fuzzy;

    if (fuzzy === false && predicate.fuzzyExplicit !== true) {
      fuzzy = undefined;
    }

    if (predicate.column === TAG_COLUMN_ID) {
      if (value === TAG_NO_LABEL_FILTER_VALUE) {
        value = null;
      }
    }

    return {
      id: predicate.id,
      column: predicate.column,
      operator,
      value,
      value2: predicate.value2,
      caseSensitive: Boolean(predicate.caseSensitive),
      fuzzy
    };
  });

  return {
    op: 'and',
    predicates
  };
};
