import type { BatchView } from './rowBatchStore';
import type { ColumnType, FilterNode, FilterPredicate, TagRecord } from './types';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from './types';
import { normalizeString } from './utils/stringUtils';
import { parseBoolean, parseDatetime, parseNumber } from './valueParsing';

/**
 * Filters are compiled once per request and evaluated batch by batch over raw cell text.
 * Text operators (eq on string columns, contains, startsWith, regex) work on any column;
 * comparison operators use the column's inferred type. `neq` and `notMatches` are the
 * exact complement of `eq` and `matches`, so empty cells are included.
 */

export class FilterError extends Error {
  override name = 'FilterError';
}

interface CompiledPredicate {
  id?: string;
  evaluate(view: BatchView, tags: Record<number, TagRecord>, cache: Map<string, string[]>): Uint8Array;
}

type CompiledNode = CompiledPredicate | { op: 'and' | 'or'; children: CompiledNode[] };

export interface CompiledFilter {
  root: CompiledNode;
}

const isExpression = (node: FilterNode): node is Extract<FilterNode, { op: string }> => 'op' in node;

// Nested quantifiers such as (a+)+ or (\w*)* backtrack exponentially in V8.
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)[+*{]/;

export const compileRegex = (pattern: string, caseSensitive: boolean): RegExp => {
  if (NESTED_QUANTIFIER.test(pattern)) {
    throw new FilterError(`Regular expression "${pattern}" has nested quantifiers and could hang the search.`);
  }
  const flags = caseSensitive ? '' : 'i';
  try {
    // Unicode mode first: legacy mode silently reads \p{Lu} as the literal text "p{Lu}".
    return new RegExp(pattern, `${flags}u`);
  } catch {
    try {
      // Legacy mode accepts common loose patterns such as [\w-.] that Unicode mode rejects.
      return new RegExp(pattern, flags);
    } catch (error) {
      throw new FilterError(`Invalid regular expression "${pattern}": ${(error as Error).message}`);
    }
  }
};

const parseBound = (type: ColumnType, value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return type === 'datetime' ? parseDatetime(value) : parseNumber(value);
};

const toComparable = (type: ColumnType, raw: string): number | null =>
  type === 'datetime' ? parseDatetime(raw) : parseNumber(raw);

const normalizedColumn = (
  view: BatchView,
  column: string,
  caseSensitive: boolean,
  cache: Map<string, string[]>
): string[] => {
  const key = `${caseSensitive ? 1 : 0}:${column}`;
  let values = cache.get(key);
  if (!values) {
    values = view.column(column).map((value) => normalizeString(value, caseSensitive));
    cache.set(key, values);
  }
  return values;
};

const maskFrom = (length: number, test: (index: number) => boolean): Uint8Array => {
  const mask = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    mask[index] = test(index) ? 1 : 0;
  }
  return mask;
};

const compileTagPredicate = (predicate: FilterPredicate): CompiledPredicate => {
  const target =
    predicate.value == null || predicate.value === TAG_NO_LABEL_FILTER_VALUE ? null : String(predicate.value);
  const negate = predicate.operator === 'neq';
  if (predicate.operator !== 'eq' && predicate.operator !== 'neq') {
    throw new FilterError(`Operator "${predicate.operator}" is not supported for labels.`);
  }
  return {
    id: predicate.id,
    evaluate(view, tags) {
      return maskFrom(view.rowCount, (index) => {
        const labelIds = tags[view.rowStart + index]?.labelIds ?? [];
        const isMatch = target === null ? labelIds.length === 0 : labelIds.includes(target);
        return isMatch !== negate;
      });
    }
  };
};

const compilePredicate = (
  predicate: FilterPredicate,
  columnTypes: Record<string, ColumnType>
): CompiledPredicate => {
  if (predicate.column === TAG_COLUMN_ID) {
    return compileTagPredicate(predicate);
  }

  const { column, operator, id } = predicate;
  const type = columnTypes[column] ?? 'string';
  const caseSensitive = Boolean(predicate.caseSensitive);
  const text = predicate.value == null ? '' : String(predicate.value);

  const textPredicate = (test: (value: string) => boolean): CompiledPredicate => ({
    id,
    evaluate(view, _tags, cache) {
      const values = normalizedColumn(view, column, caseSensitive, cache);
      return maskFrom(view.rowCount, (index) => test(values[index]!));
    }
  });

  const rawPredicate = (test: (value: string) => boolean): CompiledPredicate => ({
    id,
    evaluate(view) {
      const values = view.column(column);
      return maskFrom(view.rowCount, (index) => test(values[index]!));
    }
  });

  switch (operator) {
    case 'contains': {
      const needle = normalizeString(text, caseSensitive);
      return textPredicate((value) => value.includes(needle));
    }
    case 'startsWith': {
      const needle = normalizeString(text, caseSensitive);
      return textPredicate((value) => value.startsWith(needle));
    }
    case 'regex':
    case 'matches':
    case 'notMatches': {
      const regex = compileRegex(text, caseSensitive);
      const negate = operator === 'notMatches';
      return rawPredicate((value) => regex.test(value) !== negate);
    }
    case 'eq':
    case 'neq': {
      const negate = operator === 'neq';
      if (type === 'boolean') {
        const target = typeof predicate.value === 'boolean' ? predicate.value : parseBoolean(text);
        return rawPredicate((value) => (target != null && parseBoolean(value) === target) !== negate);
      }
      if (type === 'number' || type === 'datetime') {
        const target = parseBound(type, predicate.value);
        if (target != null) {
          return rawPredicate((value) => (toComparable(type, value) === target) !== negate);
        }
      }
      const needle = normalizeString(text, caseSensitive);
      return textPredicate((value) => (value === needle) !== negate);
    }
    case 'gt':
    case 'lt':
    case 'range':
    case 'between': {
      if (type !== 'number' && type !== 'datetime') {
        throw new FilterError(`Operator "${operator}" needs a number or datetime column; "${column}" is text.`);
      }
      const first = parseBound(type, predicate.value);
      const second = parseBound(type, predicate.value2);
      let lower = Number.NEGATIVE_INFINITY;
      let upper = Number.POSITIVE_INFINITY;
      let inclusive = true;
      if (operator === 'gt') {
        lower = first ?? lower;
        inclusive = false;
      } else if (operator === 'lt') {
        upper = first ?? upper;
        inclusive = false;
      } else {
        lower = first ?? lower;
        upper = second ?? upper;
      }
      return rawPredicate((value) => {
        const comparable = toComparable(type, value);
        if (comparable == null) {
          return false;
        }
        return inclusive
          ? comparable >= lower && comparable <= upper
          : comparable > lower && comparable < upper;
      });
    }
    default:
      throw new FilterError(`Unsupported filter operator "${operator as string}".`);
  }
};

const compileNode = (node: FilterNode, columnTypes: Record<string, ColumnType>): CompiledNode =>
  isExpression(node)
    ? { op: node.op, children: node.predicates.map((child) => compileNode(child, columnTypes)) }
    : compilePredicate(node, columnTypes);

export const compileFilter = (expression: FilterNode, columnTypes: Record<string, ColumnType>): CompiledFilter => ({
  root: compileNode(expression, columnTypes)
});

const countOnes = (mask: Uint8Array): number => {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    count += mask[index]!;
  }
  return count;
};

const evaluateNode = (
  node: CompiledNode,
  view: BatchView,
  tags: Record<number, TagRecord>,
  cache: Map<string, string[]>,
  predicateCounts: Record<string, number>
): Uint8Array => {
  if (!('op' in node)) {
    const mask = node.evaluate(view, tags, cache);
    if (node.id) {
      predicateCounts[node.id] = (predicateCounts[node.id] ?? 0) + countOnes(mask);
    }
    return mask;
  }

  if (!node.children.length) {
    return new Uint8Array(view.rowCount).fill(1);
  }

  const result = evaluateNode(node.children[0]!, view, tags, cache, predicateCounts);
  for (let childIndex = 1; childIndex < node.children.length; childIndex += 1) {
    const next = evaluateNode(node.children[childIndex]!, view, tags, cache, predicateCounts);
    for (let index = 0; index < result.length; index += 1) {
      result[index] = node.op === 'and' ? result[index]! & next[index]! : result[index]! | next[index]!;
    }
  }
  return result;
};

/** Evaluates a compiled filter against one batch; predicate match counts accumulate into `predicateCounts`. */
export const evaluateFilterOnBatch = (
  filter: CompiledFilter,
  view: BatchView,
  tags: Record<number, TagRecord>,
  predicateCounts: Record<string, number> = {}
): Uint8Array => evaluateNode(filter.root, view, tags, new Map(), predicateCounts);
