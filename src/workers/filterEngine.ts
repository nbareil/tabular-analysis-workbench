import { materializeRowBatch, type MaterializedRow } from './utils/materializeRowBatch';
import type {
  ColumnType,
  FilterExpression,
  FilterNode,
  FilterPredicate,
  RowBatch,
  TagRecord
} from './types';
import { TAG_COLUMN_ID } from './types';
import type { FuzzyIndexSnapshot } from './fuzzyIndexStore';
import { FuzzyIndexBuilder } from './fuzzyIndexBuilder';
import { normalizeString } from './utils/stringUtils';

export interface FuzzyMatchInfo {
  query: string;
  suggestions: string[];
  maxDistance: number;
}

export interface FilterResult {
  matches: Uint8Array;
  matchedCount: number;
  fuzzyUsed?: FuzzyMatchInfo;
}

export interface FilterEvaluationContext {
  tags?: Record<number, TagRecord>;
  fuzzyIndex?: FuzzyIndexSnapshot | null;
}

const isExpression = (node: FilterNode): node is FilterExpression => 'op' in node;

const parseBooleanValue = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    if (['true', 't', 'yes', 'y', '1'].includes(normalised)) {
      return true;
    }
    if (['false', 'f', 'no', 'n', '0'].includes(normalised)) {
      return false;
    }
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  return null;
};

const parseNumericValue = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
};

const parseDateValue = (value: unknown): number | null => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return null;
};

const createRegex = (pattern: string, caseSensitive?: boolean): RegExp | null => {
  try {
    const flags = caseSensitive ? 'u' : 'iu';
    return new RegExp(pattern, flags);
  } catch (error) {
    console.warn('[filter-engine] Invalid regex pattern', error);
    return null;
  }
};



const evaluateTagPredicate = (
  rows: Array<Record<string, unknown>>,
  predicate: FilterPredicate,
  context: FilterEvaluationContext
): { matches: Uint8Array; fuzzyInfo?: FuzzyMatchInfo } => {
  const result = new Uint8Array(rows.length);
  const operator = predicate.operator;

  if (operator !== 'eq' && operator !== 'neq') {
  return { matches: result };
  }

  const target =
    typeof predicate.value === 'string'
      ? predicate.value
      : predicate.value === null
        ? null
        : String(predicate.value ?? '');
  const tags = context.tags ?? {};

  for (let index = 0; index < rows.length; index += 1) {
    const materialized = rows[index] as MaterializedRow | undefined;
    const rowId = materialized?.__rowId;
    if (rowId == null || !Number.isFinite(rowId)) {
      result[index] = operator === 'neq' ? 1 : 0;
      continue;
    }

    const record = tags[rowId];
    const labelId = record?.labelId ?? null;
    const isMatch = target === null ? labelId == null : labelId === target;

    if (operator === 'eq') {
      result[index] = isMatch ? 1 : 0;
    } else {
      result[index] = isMatch ? 0 : 1;
    }
    }

    return { matches: result };
};

const evaluatePredicate = (
  rows: Array<Record<string, unknown>>,
  columnTypes: Record<string, ColumnType>,
  predicate: FilterPredicate,
  context: FilterEvaluationContext
): { matches: Uint8Array; fuzzyInfo?: FuzzyMatchInfo } => {
  if (predicate.column === TAG_COLUMN_ID) {
    return evaluateTagPredicate(rows, predicate, context);
  }

  const rowCount = rows.length;
  const result = new Uint8Array(rowCount);
  const columnType = columnTypes[predicate.column] ?? 'string';
  const values = rows.map((row) => row[predicate.column]);

  switch (columnType) {
    case 'string': {
      const targetValue = typeof predicate.value === 'string' ? predicate.value : String(predicate.value ?? '');
      const targetNormalised = normalizeString(targetValue, predicate.caseSensitive ?? false);
      const valuesNormalised = values.map((value) =>
        normalizeString(String(value ?? ''), predicate.caseSensitive ?? false)
      );

      if (predicate.operator === 'eq' || predicate.operator === 'neq') {
        let hasExactMatches = false;
        for (let index = 0; index < rowCount; index += 1) {
          const exactMatch = valuesNormalised[index] === targetNormalised;
          if (exactMatch) hasExactMatches = true;
          result[index] = predicate.operator === 'eq' ? (exactMatch ? 1 : 0) : exactMatch ? 0 : 1;
        }

        // If fuzzy is enabled and no exact matches, try fuzzy search
        let fuzzyInfo: FuzzyMatchInfo | undefined;
        if (predicate.fuzzy && !hasExactMatches && context.fuzzyIndex) {
          const columnSnapshot = context.fuzzyIndex.columns.find(col => col.key === predicate.column);
          if (columnSnapshot) {
            const builder = new FuzzyIndexBuilder();
            const fuzzyMatches = builder.searchColumn(
              columnSnapshot,
              targetValue,
              2, // maxDistance from PRD
              5 // top 5 suggestions
            );

            fuzzyInfo = {
              query: targetValue,
              suggestions: fuzzyMatches.map(m => m.token),
              maxDistance: 2
            };

            // For each fuzzy match, find rows containing that token
            for (const fuzzyMatch of fuzzyMatches) {
              const matchedToken = fuzzyMatch.token;
              for (let index = 0; index < rowCount; index += 1) {
                if (valuesNormalised[index].includes(matchedToken)) {
                  result[index] = predicate.operator === 'eq' ? 1 : 0;
                }
              }
            }
          }
        }

        return { matches: result, fuzzyInfo };
        break;
      }

      if (predicate.operator === 'contains') {
        for (let index = 0; index < rowCount; index += 1) {
          const valueString = valuesNormalised[index];
          result[index] = valueString.includes(targetNormalised) ? 1 : 0;
        }
        return { matches: result };
      }

      if (predicate.operator === 'startsWith') {
        for (let index = 0; index < rowCount; index += 1) {
          const valueString = valuesNormalised[index];
          result[index] = valueString.startsWith(targetNormalised) ? 1 : 0;
        }
        return { matches: result };
      }

      if (
        (predicate.operator === 'regex' ||
          predicate.operator === 'matches' ||
          predicate.operator === 'notMatches') &&
        typeof predicate.value === 'string'
      ) {
        const regex = createRegex(predicate.value, predicate.caseSensitive);
        if (!regex) {
          return { matches: result };
        }

        for (let index = 0; index < rowCount; index += 1) {
          const matches = regex.test(String(values[index] ?? ''));
          if (predicate.operator === 'notMatches') {
            result[index] = matches ? 0 : 1;
          } else {
            result[index] = matches ? 1 : 0;
          }
        }
        return { matches: result };
      }

      // Fallback: unsupported operator for string yields zeros.
      return { matches: result };
    }
    case 'number': {
      const numericValue = parseNumericValue(predicate.value);
      const numericValue2 = parseNumericValue(predicate.value2);

      for (let index = 0; index < rowCount; index += 1) {
        const value = values[index];
        if (value == null || typeof value !== 'number' || Number.isNaN(value)) {
          result[index] = 0;
          continue;
        }

        switch (predicate.operator) {
          case 'eq':
            result[index] = numericValue != null && value === numericValue ? 1 : 0;
            break;
          case 'neq':
            result[index] = numericValue != null && value === numericValue ? 0 : 1;
            break;
          case 'gt':
            result[index] = numericValue != null && value > numericValue ? 1 : 0;
            break;
          case 'lt':
            result[index] = numericValue != null && value < numericValue ? 1 : 0;
            break;
          case 'range':
          case 'between': {
            if (numericValue == null && numericValue2 == null) {
              result[index] = 0;
              break;
            }
            const lower = numericValue ?? Number.NEGATIVE_INFINITY;
            const upper = numericValue2 ?? Number.POSITIVE_INFINITY;
            result[index] = value >= lower && value <= upper ? 1 : 0;
            break;
          }
          default:
            result[index] = 0;
        }
        }
        return { matches: result };
        }
    case 'datetime': {
      const baseValue = parseDateValue(predicate.value);
      const baseValue2 = parseDateValue(predicate.value2);

      for (let index = 0; index < rowCount; index += 1) {
        const valueRaw = values[index];
        const value =
          typeof valueRaw === 'number'
            ? valueRaw
            : typeof valueRaw === 'string'
              ? parseDateValue(valueRaw)
              : null;

        if (value == null || Number.isNaN(value)) {
          result[index] = 0;
          continue;
        }

        switch (predicate.operator) {
          case 'eq':
            result[index] = baseValue != null && value === baseValue ? 1 : 0;
            break;
          case 'neq':
            result[index] = baseValue != null && value === baseValue ? 0 : 1;
            break;
          case 'gt':
            result[index] = baseValue != null && value > baseValue ? 1 : 0;
            break;
          case 'lt':
            result[index] = baseValue != null && value < baseValue ? 1 : 0;
            break;
          case 'range':
          case 'between': {
            if (baseValue == null && baseValue2 == null) {
              result[index] = 0;
              break;
            }
            const lower = baseValue ?? Number.NEGATIVE_INFINITY;
            const upper = baseValue2 ?? Number.POSITIVE_INFINITY;
            result[index] = value >= lower && value <= upper ? 1 : 0;
            break;
          }
          default:
            result[index] = 0;
        }
        }
        return { matches: result };
        }
    case 'boolean': {
      const target = parseBooleanValue(predicate.value);
      if (target == null) {
        return { matches: result };
      }

      for (let index = 0; index < rowCount; index += 1) {
        const value = values[index];
        if (typeof value !== 'boolean') {
          result[index] = 0;
          continue;
        }

        if (predicate.operator === 'eq') {
          result[index] = value === target ? 1 : 0;
        } else if (predicate.operator === 'neq') {
          result[index] = value === target ? 0 : 1;
        } else {
          result[index] = 0;
        }
      }
      return { matches: result };
    }
    default:
      return { matches: result };
  }
};

const combineMasks = (
  left: Uint8Array,
  right: Uint8Array,
  op: 'and' | 'or'
): Uint8Array => {
  const length = left.length;
  const result = new Uint8Array(length);

  if (op === 'and') {
    for (let index = 0; index < length; index += 1) {
      result[index] = left[index] === 1 && right[index] === 1 ? 1 : 0;
    }
  } else {
    for (let index = 0; index < length; index += 1) {
      result[index] = left[index] === 1 || right[index] === 1 ? 1 : 0;
    }
  }

  return result;
};

const evaluateNode = (
  rows: Array<Record<string, unknown>>,
  columnTypes: Record<string, ColumnType>,
  node: FilterNode,
  context: FilterEvaluationContext
): { matches: Uint8Array; fuzzyInfo?: FuzzyMatchInfo } => {
  if (isExpression(node)) {
    if (!node.predicates.length) {
      return { matches: new Uint8Array(rows.length).fill(1) };
    }

    let accumulator = evaluateNode(rows, columnTypes, node.predicates[0]!, context);

    for (let index = 1; index < node.predicates.length; index += 1) {
      const next = evaluateNode(rows, columnTypes, node.predicates[index]!, context);
      accumulator = {
        matches: combineMasks(accumulator.matches, next.matches, node.op),
        fuzzyInfo: accumulator.fuzzyInfo || next.fuzzyInfo // take first fuzzyInfo
      };
    }

    return accumulator;
  }

  return evaluatePredicate(rows, columnTypes, node, context);
};

const evaluateFilterInternal = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  expression: FilterNode | null,
  context: FilterEvaluationContext
): FilterResult => {
  const rowCount = rows.length;

  if (!expression) {
    const matches = new Uint8Array(rowCount).fill(1);
    return { matches, matchedCount: rowCount };
  }

  const result = evaluateNode(rows, columnTypes, expression, context);
  let matchedCount = 0;
  for (let index = 0; index < result.matches.length; index += 1) {
    if (result.matches[index] === 1) {
      matchedCount += 1;
    }
  }

  return { matches: result.matches, matchedCount, fuzzyUsed: result.fuzzyInfo };
};

export const evaluateFilterOnRows = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  expression: FilterNode | null,
  context: FilterEvaluationContext = {}
): FilterResult => evaluateFilterInternal(rows, columnTypes, expression, context);

export const evaluateFilterOnBatch = (
  batch: RowBatch,
  expression: FilterNode | null,
  context: FilterEvaluationContext = {}
): FilterResult => {
  const materialised = materializeRowBatch(batch);
  return evaluateFilterInternal(materialised.rows, batch.columnTypes, expression, context);
};

export const evaluateFilter = evaluateFilterOnBatch;

export const collectMatchingRowIdsFromRows = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  expression: FilterNode | null,
  context: FilterEvaluationContext = {}
): Uint32Array => {
  const { matches } = evaluateFilterInternal(rows, columnTypes, expression, context);
  const selected: number[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    if (matches[index] === 1) {
      selected.push(rows[index]!.__rowId);
    }
  }

  return Uint32Array.from(selected);
};

export const collectMatchingRowIds = (
  batch: RowBatch,
  expression: FilterNode | null,
  context: FilterEvaluationContext = {}
): Uint32Array => {
  const materialised = materializeRowBatch(batch);
  return collectMatchingRowIdsFromRows(materialised.rows, batch.columnTypes, expression, context);
};
