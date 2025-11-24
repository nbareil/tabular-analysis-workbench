import { materializeRowBatch, type MaterializedRow } from './utils/materializeRowBatch';
import type {
  ColumnType,
  FilterExpression,
  FilterNode,
  FilterPredicate,
  RowBatch,
  TagRecord
} from './types';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from './types';
import type { FuzzyIndexSnapshot } from './fuzzyIndexStore';
import { FuzzyIndexBuilder } from './fuzzyIndexBuilder';
import { normalizeString } from './utils/stringUtils';
import { damerauLevenshtein } from './utils/levenshtein';

export interface FuzzyMatchInfo {
  column: string;
  operator: FilterPredicate['operator'];
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

interface FilterEvaluationOptions {
  collectPredicateMatch?: (predicateId: string, count: number) => void;
}

const countMatches = (mask: Uint8Array): number => {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 1) {
      count += 1;
    }
  }
  return count;
};

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

const clampExplicitDistance = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  const rounded = Math.floor(value);
  if (rounded < 1) {
    return null;
  }
  return Math.min(3, rounded);
};
const tokenizeFuzzyQuery = (value: string): string[] => {
  const normalized = value.toLowerCase().normalize('NFC');
  const tokens = normalized
    .split(/[\s\p{P}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  if (tokens.length > 0) {
    return tokens;
  }

  return normalized ? [normalized] : [];
};

const tokenizeValueForFuzzy = (value: string): string[] => {
  const normalized = value.toLowerCase().normalize('NFC');
  const tokens = normalized
    .split(/[\s\p{P}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return tokens.length > 0 ? tokens : normalized ? [normalized] : [];
};

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
    predicate.value === TAG_NO_LABEL_FILTER_VALUE
      ? null
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
    const labelIds = Array.isArray(record?.labelIds) ? record.labelIds : [];
    const isMatch = target === null ? labelIds.length === 0 : labelIds.includes(target);

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
      const explicitDistance = clampExplicitDistance(predicate.fuzzyDistance);

      if (predicate.operator === 'eq' || predicate.operator === 'neq') {
        let hasExactMatches = false;
        for (let index = 0; index < rowCount; index += 1) {
          const exactMatch = valuesNormalised[index] === targetNormalised;
          if (exactMatch) hasExactMatches = true;
          result[index] = predicate.operator === 'eq' ? (exactMatch ? 1 : 0) : exactMatch ? 0 : 1;
        }

        // Determine whether fuzzy fallback should run.
        const trimmedQuery = targetValue.trim();
        const queryTokens = tokenizeFuzzyQuery(trimmedQuery);
        const tokenConfigs = queryTokens.map((token) => ({
          token,
          distance: explicitDistance ?? determineMaxDistance(token)
        }));
        const maxTokenDistance = tokenConfigs.reduce(
          (acc, config) => Math.max(acc, config.distance),
          0
        );
        const forceFuzzy = predicate.fuzzy === true;
        const allowAutoFuzzy =
          predicate.fuzzy !== false && !hasExactMatches && maxTokenDistance > 0;
        const infoMaxDistance =
          explicitDistance ?? (forceFuzzy ? Math.max(maxTokenDistance, 1) : maxTokenDistance);
        const fuzzyIndex = context.fuzzyIndex;
        let fuzzyInfo: FuzzyMatchInfo | undefined;

        if (fuzzyIndex && (allowAutoFuzzy || (forceFuzzy && tokenConfigs.length > 0))) {
          const columnSnapshot = fuzzyIndex.columns.find((col) => col.key === predicate.column);
          if (columnSnapshot) {
            const builder = new FuzzyIndexBuilder({
              trigramSize:
                typeof fuzzyIndex.trigramSize === 'number' &&
                Number.isFinite(fuzzyIndex.trigramSize)
                  ? fuzzyIndex.trigramSize
                  : 3
            });
            const matchesByToken = new Map<
              string,
              { token: string; distance: number; frequency: number }
            >();

            for (const config of tokenConfigs) {
              const effectiveDistance =
                forceFuzzy && config.distance === 0 ? 1 : config.distance;
              if (effectiveDistance <= 0) {
                continue;
              }

              const tokenMatches = builder.searchColumn(
                columnSnapshot,
                config.token,
                effectiveDistance,
                5
              );

              for (const match of tokenMatches) {
                const existing = matchesByToken.get(match.token);
                if (!existing || match.distance < existing.distance) {
                  matchesByToken.set(match.token, match);
                }
              }
            }

            const fuzzyMatches = Array.from(matchesByToken.values()).sort((a, b) => {
              if (a.distance !== b.distance) {
                return a.distance - b.distance;
              }
              return b.frequency - a.frequency;
            });

            if (allowAutoFuzzy) {
              fuzzyInfo = {
                column: predicate.column,
                operator: predicate.operator,
                query: trimmedQuery,
                suggestions: fuzzyMatches.slice(0, 5).map((match) => match.token),
                maxDistance: infoMaxDistance
              };
            }

            if (tokenConfigs.length > 0) {
              const rowTokenCache: Array<string[] | null> = new Array(rowCount).fill(null);
              const resolveRowTokens = (index: number): string[] => {
                const cached = rowTokenCache[index];
                if (cached) {
                  return cached;
                }
                const tokens = tokenizeValueForFuzzy(valuesNormalised[index]);
                rowTokenCache[index] = tokens;
                return tokens;
              };

              for (let index = 0; index < rowCount; index += 1) {
                const rowTokens = resolveRowTokens(index);
                if (!rowTokens.length) {
                  continue;
                }

                const matchesFuzzy = tokenConfigs.some((config) => {
                  const distanceLimit =
                    forceFuzzy && config.distance === 0 ? 1 : config.distance;
                  if (distanceLimit <= 0) {
                    return rowTokens.some((token) => token.includes(config.token));
                  }

                  return rowTokens.some(
                    (token) =>
                      damerauLevenshtein(token, config.token, distanceLimit) <= distanceLimit
                  );
                });

                if (!matchesFuzzy) {
                  continue;
                }

                if (predicate.operator === 'eq') {
                  result[index] = 1;
                } else {
                  result[index] = 0;
                }
              }
            }
          }
        }

        return { matches: result, fuzzyInfo };
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
  context: FilterEvaluationContext,
  options?: FilterEvaluationOptions
): { matches: Uint8Array; fuzzyInfo?: FuzzyMatchInfo } => {
  if (isExpression(node)) {
    if (!node.predicates.length) {
      return { matches: new Uint8Array(rows.length).fill(1) };
    }

    let accumulator = evaluateNode(rows, columnTypes, node.predicates[0]!, context, options);

    for (let index = 1; index < node.predicates.length; index += 1) {
      const next = evaluateNode(rows, columnTypes, node.predicates[index]!, context, options);
      accumulator = {
        matches: combineMasks(accumulator.matches, next.matches, node.op),
        fuzzyInfo: accumulator.fuzzyInfo || next.fuzzyInfo // take first fuzzyInfo
      };
    }

    return accumulator;
  }

  const predicateResult = evaluatePredicate(rows, columnTypes, node, context);
  if (options?.collectPredicateMatch && node.id) {
    options.collectPredicateMatch(node.id, countMatches(predicateResult.matches));
  }
  return predicateResult;
};

const evaluateFilterInternal = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  expression: FilterNode | null,
  context: FilterEvaluationContext,
  options?: FilterEvaluationOptions
): FilterResult => {
  const rowCount = rows.length;

  if (!expression) {
    const matches = new Uint8Array(rowCount).fill(1);
    return { matches, matchedCount: rowCount };
  }

  const result = evaluateNode(rows, columnTypes, expression, context, options);
  const matchedCount = countMatches(result.matches);

  return { matches: result.matches, matchedCount, fuzzyUsed: result.fuzzyInfo };
};

export const evaluateFilterOnRows = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  expression: FilterNode | null,
  context: FilterEvaluationContext = {},
  options?: FilterEvaluationOptions
): FilterResult => evaluateFilterInternal(rows, columnTypes, expression, context, options);

export const evaluateFilterOnBatch = (
  batch: RowBatch,
  expression: FilterNode | null,
  context: FilterEvaluationContext = {},
  options?: FilterEvaluationOptions
): FilterResult => {
  const materialised = materializeRowBatch(batch);
  return evaluateFilterInternal(materialised.rows, batch.columnTypes, expression, context, options);
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
