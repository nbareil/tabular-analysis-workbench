import {
  TAG_COLUMN_ID,
  TAG_NO_LABEL_FILTER_VALUE,
  type FilterNode,
  type FilterPredicate
} from '@workers/types';
import type { FilterState } from '@state/sessionStore';

const isBlankValue = (value: unknown): boolean => {
  if (value == null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  return false;
};

export const isFilterComplete = (filter: FilterState): boolean => {
  if (filter.enabled === false) {
    return false;
  }

  if (!filter.column || !filter.operator) {
    return false;
  }

  if (filter.column === TAG_COLUMN_ID) {
    return !isBlankValue(filter.value);
  }

  switch (filter.operator) {
    case 'between':
    case 'range':
      return !isBlankValue(filter.value) || !isBlankValue(filter.value2);
    case 'eq':
    case 'neq':
    case 'contains':
    case 'startsWith':
    case 'matches':
    case 'notMatches':
    case 'gt':
    case 'lt':
      return !isBlankValue(filter.value);
    default:
      return !isBlankValue(filter.value);
  }
};

export const buildFilterExpression = (filters: FilterState[]): FilterNode | null => {
  const activeFilters = filters.filter(isFilterComplete);
  if (!activeFilters.length) {
    return null;
  }

  const predicates: FilterPredicate[] = activeFilters.map((predicate) => {
    const operator = predicate.operator as FilterPredicate['operator'];
    let value = predicate.value;

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
      caseSensitive: Boolean(predicate.caseSensitive)
    };
  });

  return {
    op: 'and',
    predicates
  };
};
