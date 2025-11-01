import type { FilterNode, FilterPredicate } from '@workers/types';
import type { FilterState } from '@state/sessionStore';

export const buildFilterExpression = (filters: FilterState[]): FilterNode | null => {
  if (!filters.length) {
    return null;
  }

  const predicates: FilterPredicate[] = filters.map((predicate) => ({
    column: predicate.column,
    operator: predicate.operator as FilterPredicate['operator'],
    value: predicate.value,
    value2: predicate.value2,
    caseSensitive: Boolean(predicate.caseSensitive),
    fuzzy: predicate.fuzzy
  }));

  return {
    op: 'and',
    predicates
  };
};
