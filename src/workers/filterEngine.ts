import { materializeRowBatch, type MaterializedRow } from './utils/materializeRowBatch';
import type {
  ColumnType,
  FilterExpression,
  FilterNode,
  FilterPredicate,
  RowBatch
} from './types';

export interface FilterResult {
  matches: Uint8Array;
  matchedCount: number;
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

const normaliseString = (value: string, caseSensitive?: boolean): string =>
  caseSensitive ? value : value.toLowerCase();

const evaluatePredicate = (
  rows: Array<Record<string, unknown>>,
  columnTypes: Record<string, ColumnType>,
  predicate: FilterPredicate
): Uint8Array => {
  const rowCount = rows.length;
  const result = new Uint8Array(rowCount);
  const columnType = columnTypes[predicate.column] ?? 'string';
  const values = rows.map((row) => row[predicate.column]);

  switch (columnType) {
    case 'string': {
      const targetValue = typeof predicate.value === 'string' ? predicate.value : String(predicate.value ?? '');
      const targetNormalised = normaliseString(targetValue, predicate.caseSensitive);
      const valuesNormalised = values.map((value) =>
        normaliseString(String(value ?? ''), predicate.caseSensitive)
      );

      if (predicate.operator === 'eq' || predicate.operator === 'neq') {
        for (let index = 0; index < rowCount; index += 1) {
          const matches = valuesNormalised[index] === targetNormalised;
          result[index] = predicate.operator === 'eq' ? (matches ? 1 : 0) : matches ? 0 : 1;
        }
        break;
      }

      if (predicate.operator === 'contains') {
        for (let index = 0; index < rowCount; index += 1) {
          const valueString = valuesNormalised[index];
          result[index] = valueString.includes(targetNormalised) ? 1 : 0;
        }
        break;
      }

      if (predicate.operator === 'startsWith') {
        for (let index = 0; index < rowCount; index += 1) {
          const valueString = valuesNormalised[index];
          result[index] = valueString.startsWith(targetNormalised) ? 1 : 0;
        }
        break;
      }

      if (
        (predicate.operator === 'regex' ||
          predicate.operator === 'matches' ||
          predicate.operator === 'notMatches') &&
        typeof predicate.value === 'string'
      ) {
        const regex = createRegex(predicate.value, predicate.caseSensitive);
        if (!regex) {
          return result;
        }

        for (let index = 0; index < rowCount; index += 1) {
          const matches = regex.test(String(values[index] ?? ''));
          if (predicate.operator === 'notMatches') {
            result[index] = matches ? 0 : 1;
          } else {
            result[index] = matches ? 1 : 0;
          }
        }
        break;
      }

      // Fallback: unsupported operator for string yields zeros.
      break;
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
      break;
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
      break;
    }
    case 'boolean': {
      const target = parseBooleanValue(predicate.value);
      if (target == null) {
        return result;
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
      break;
    }
    default:
      break;
  }

  return result;
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
  node: FilterNode
): Uint8Array => {
  if (isExpression(node)) {
    if (!node.predicates.length) {
      return new Uint8Array(rows.length).fill(1);
    }

    let accumulator = evaluateNode(rows, columnTypes, node.predicates[0]!);

    for (let index = 1; index < node.predicates.length; index += 1) {
      const next = evaluateNode(rows, columnTypes, node.predicates[index]!);
      accumulator = combineMasks(accumulator, next, node.op);
    }

    return accumulator;
  }

  return evaluatePredicate(rows, columnTypes, node);
};

const evaluateFilterInternal = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  expression: FilterNode | null
): FilterResult => {
  const rowCount = rows.length;

  if (!expression) {
    const matches = new Uint8Array(rowCount).fill(1);
    return { matches, matchedCount: rowCount };
  }

  const mask = evaluateNode(rows, columnTypes, expression);
  let matchedCount = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 1) {
      matchedCount += 1;
    }
  }

  return { matches: mask, matchedCount };
};

export const evaluateFilterOnRows = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  expression: FilterNode | null
): FilterResult => evaluateFilterInternal(rows, columnTypes, expression);

export const evaluateFilterOnBatch = (batch: RowBatch, expression: FilterNode | null): FilterResult => {
  const materialised = materializeRowBatch(batch);
  return evaluateFilterInternal(materialised.rows, batch.columnTypes, expression);
};

export const evaluateFilter = evaluateFilterOnBatch;

export const collectMatchingRowIdsFromRows = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  expression: FilterNode | null
): Uint32Array => {
  const { matches } = evaluateFilterInternal(rows, columnTypes, expression);
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
  expression: FilterNode | null
): Uint32Array => {
  const materialised = materializeRowBatch(batch);
  return collectMatchingRowIdsFromRows(materialised.rows, batch.columnTypes, expression);
};
