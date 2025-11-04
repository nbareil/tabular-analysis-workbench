import {
  TAG_COLUMN_ID,
  TAG_NO_LABEL_FILTER_VALUE,
  type FilterNode,
  type FilterPredicate
} from '@workers/types';
import type { FilterState } from '@state/sessionStore';

export const buildFilterExpression = (filters: FilterState[]): FilterNode | null => {
  if (!filters.length) {
    return null;
  }

  const predicates: FilterPredicate[] = filters.map((predicate) => {
    const operator = predicate.operator as FilterPredicate['operator'];
    let value = predicate.value;

    if (predicate.column === TAG_COLUMN_ID) {
      if (value === TAG_NO_LABEL_FILTER_VALUE) {
        value = null;
      }
    }

    return {
      column: predicate.column,
      operator,
      value,
      value2: predicate.value2,
      caseSensitive: Boolean(predicate.caseSensitive),
      fuzzy: predicate.fuzzy
    };
  });

  return {
    op: 'and',
    predicates
  };
};
