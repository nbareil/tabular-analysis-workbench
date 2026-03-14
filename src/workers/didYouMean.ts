import type { RowBatchStore } from './rowBatchStore';
import type { ColumnType, FilterNode, FilterPredicate } from './types';
import { TAG_COLUMN_ID } from './types';
import { damerauLevenshtein } from './utils/levenshtein';
import { normalizeString } from './utils/stringUtils';

export interface DidYouMeanInfo {
  column: string;
  operator: FilterPredicate['operator'];
  query: string;
  suggestions: string[];
}

interface SuggestionCandidate {
  value: string;
  distance: number;
  occurrences: number;
}

const isExpression = (node: FilterNode): node is Extract<FilterNode, { op: 'and' | 'or' }> =>
  'op' in node;

const determineMaxDistance = (value: string): number => {
  const trimmed = value.trim();
  if (trimmed.length >= 5) {
    return 2;
  }
  if (trimmed.length >= 3) {
    return 1;
  }
  return 0;
};

const collectSuggestionPredicates = (
  node: FilterNode,
  columnTypes: Record<string, ColumnType>,
  predicates: FilterPredicate[] = []
): FilterPredicate[] => {
  if (isExpression(node)) {
    for (const predicate of node.predicates) {
      collectSuggestionPredicates(predicate, columnTypes, predicates);
    }
    return predicates;
  }

  if (
    node.column !== TAG_COLUMN_ID &&
    node.operator === 'eq' &&
    typeof node.value === 'string' &&
    node.value.trim().length > 0 &&
    (columnTypes[node.column] ?? 'string') === 'string'
  ) {
    predicates.push(node);
  }

  return predicates;
};

const rankSuggestions = (candidates: Iterable<SuggestionCandidate>): string[] => {
  return Array.from(candidates)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        right.occurrences - left.occurrences ||
        left.value.localeCompare(right.value)
    )
    .slice(0, 5)
    .map((candidate) => candidate.value);
};

const findSuggestionsForPredicate = async (
  batchStore: RowBatchStore,
  predicate: FilterPredicate
): Promise<string[]> => {
  const query = typeof predicate.value === 'string' ? predicate.value.trim() : '';
  if (!query) {
    return [];
  }
  const maxDistance = determineMaxDistance(query);
  if (maxDistance <= 0) {
    return [];
  }

  const normalizedQuery = normalizeString(query, predicate.caseSensitive ?? false);
  if (!normalizedQuery) {
    return [];
  }

  const candidates = new Map<string, SuggestionCandidate>();

  for await (const { rows } of batchStore.iterateMaterializedBatches()) {
    for (const row of rows) {
      const rawValue = row[predicate.column];
      if (rawValue == null) {
        continue;
      }

      const candidateValue = String(rawValue).trim();
      if (!candidateValue) {
        continue;
      }

      const normalizedCandidate = normalizeString(
        candidateValue,
        predicate.caseSensitive ?? false
      );
      if (!normalizedCandidate || normalizedCandidate === normalizedQuery) {
        continue;
      }

      if (Math.abs(normalizedCandidate.length - normalizedQuery.length) > maxDistance) {
        continue;
      }

      const distance = damerauLevenshtein(normalizedQuery, normalizedCandidate, maxDistance);
      if (distance > maxDistance) {
        continue;
      }

      const existing = candidates.get(normalizedCandidate);
      if (!existing) {
        candidates.set(normalizedCandidate, {
          value: candidateValue,
          distance,
          occurrences: 1
        });
        continue;
      }

      existing.occurrences += 1;
      if (
        distance < existing.distance ||
        (distance === existing.distance && candidateValue.length < existing.value.length)
      ) {
        existing.value = candidateValue;
        existing.distance = distance;
      }
    }
  }

  return rankSuggestions(candidates.values());
};

export const suggestDidYouMean = async ({
  batchStore,
  expression,
  columnTypes
}: {
  batchStore: RowBatchStore;
  expression: FilterNode | null;
  columnTypes: Record<string, ColumnType>;
}): Promise<DidYouMeanInfo | undefined> => {
  if (!expression) {
    return undefined;
  }

  const predicates = collectSuggestionPredicates(expression, columnTypes);
  for (const predicate of predicates) {
    const suggestions = await findSuggestionsForPredicate(batchStore, predicate);
    if (suggestions.length > 0) {
      return {
        column: predicate.column,
        operator: predicate.operator,
        query: typeof predicate.value === 'string' ? predicate.value.trim() : '',
        suggestions
      };
    }
  }

  return undefined;
};
