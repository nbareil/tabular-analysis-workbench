import type {
  AggregateOperator,
  ColumnType,
  GroupAggregationDefinition,
  GroupingRequest,
  GroupingResult,
  GroupingRow
} from './types';
import type { MaterializedRow } from './utils/materializeRowBatch';

type ComparableValue = number | string;

interface AggregatorTemplate {
  alias: string;
  operator: AggregateOperator;
  column?: string;
  columnType?: ColumnType;
  columnAvailable: boolean;
}

interface GroupAggregatorState extends AggregatorTemplate {
  totalCount: number;
  validCount: number;
  sum: number;
  minComparable: ComparableValue | null;
  minValue: unknown;
  maxComparable: ComparableValue | null;
  maxValue: unknown;
}

interface GroupAccumulator {
  keySignature: string;
  keyValues: unknown[];
  rowCount: number;
  aggregators: GroupAggregatorState[];
}

const DEFAULT_AGGREGATIONS: GroupAggregationDefinition[] = [
  {
    operator: 'count',
    alias: 'count'
  }
];

export const resolveAggregationAlias = (definition: GroupAggregationDefinition): string => {
  if (definition.alias) {
    return definition.alias;
  }

  if (definition.operator === 'count' && !definition.column) {
    return 'count';
  }

  const columnPart = definition.column ?? '*';
  return `${definition.operator}(${columnPart})`;
};

const createTemplate = (
  definition: GroupAggregationDefinition,
  columnTypes: Record<string, ColumnType>
): AggregatorTemplate => {
  const columnType = definition.column ? columnTypes[definition.column] : undefined;

  return {
    alias: resolveAggregationAlias(definition),
    operator: definition.operator,
    column: definition.column,
    columnType,
    columnAvailable: definition.column ? columnType != null : true
  };
};

const cloneTemplateState = (template: AggregatorTemplate): GroupAggregatorState => ({
  ...template,
  totalCount: 0,
  validCount: 0,
  sum: 0,
  minComparable: null,
  minValue: null,
  maxComparable: null,
  maxValue: null
});

const serialiseGroupFragment = (value: unknown): string => {
  if (value == null) {
    return 'null';
  }

  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'number:nan';
    }
    return `number:${value}`;
  }

  if (typeof value === 'boolean') {
    return `boolean:${value ? '1' : '0'}`;
  }

  if (typeof value === 'string') {
    return `string:${value}`;
  }

  return `${typeof value}:${String(value)}`;
};

const buildGroupSignature = (keyValues: unknown[]): string =>
  keyValues.map(serialiseGroupFragment).join('|');

const compareLess = (left: ComparableValue, right: ComparableValue): boolean => {
  if (typeof left === 'number' && typeof right === 'number') {
    return left < right;
  }

  return String(left) < String(right);
};

const compareGreater = (left: ComparableValue, right: ComparableValue): boolean => {
  if (typeof left === 'number' && typeof right === 'number') {
    return left > right;
  }

  return String(left) > String(right);
};

const extractComparable = (
  value: unknown,
  columnType: ColumnType | undefined
): { comparable: ComparableValue | null; original: unknown } => {
  if (value == null) {
    return { comparable: null, original: null };
  }

  switch (columnType) {
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { comparable: value, original: value };
      }
      if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          return { comparable: numeric, original: numeric };
        }
      }
      return { comparable: null, original: null };
    }
    case 'datetime': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { comparable: value, original: value };
      }
      if (typeof value === 'string') {
        const timestamp = Date.parse(value);
        if (Number.isFinite(timestamp)) {
          return { comparable: timestamp, original: value };
        }
      }
      return { comparable: null, original: null };
    }
    case 'boolean': {
      if (typeof value === 'boolean') {
        return { comparable: value ? 1 : 0, original: value };
      }
      return { comparable: null, original: null };
    }
    case 'string':
    default: {
      const str = typeof value === 'string' ? value : String(value);
      return { comparable: str, original: str };
    }
  }
};

const updateAggregatorState = (state: GroupAggregatorState, row: MaterializedRow): void => {
  switch (state.operator) {
    case 'count': {
      if (!state.column) {
        state.totalCount += 1;
        return;
      }

      if (!state.columnAvailable) {
        return;
      }

      if (row[state.column] != null) {
        state.validCount += 1;
      }
      return;
    }
    case 'sum':
    case 'avg': {
      if (!state.column || !state.columnAvailable || state.columnType !== 'number') {
        return;
      }

      const value = row[state.column];
      if (typeof value === 'number' && Number.isFinite(value)) {
        state.sum += value;
        state.validCount += 1;
      }
      return;
    }
    case 'min': {
      if (!state.column || !state.columnAvailable) {
        return;
      }

      const { comparable, original } = extractComparable(row[state.column], state.columnType);
      if (comparable == null) {
        return;
      }

      state.validCount += 1;
      if (state.minComparable == null || compareLess(comparable, state.minComparable)) {
        state.minComparable = comparable;
        state.minValue = original;
      }
      return;
    }
    case 'max': {
      if (!state.column || !state.columnAvailable) {
        return;
      }

      const { comparable, original } = extractComparable(row[state.column], state.columnType);
      if (comparable == null) {
        return;
      }

      state.validCount += 1;
      if (state.maxComparable == null || compareGreater(comparable, state.maxComparable)) {
        state.maxComparable = comparable;
        state.maxValue = original;
      }
      return;
    }
    default:
      return;
  }
};

const finaliseAggregatorValue = (
  state: GroupAggregatorState,
  groupRowCount: number
): unknown => {
  switch (state.operator) {
    case 'count':
      return state.column ? state.validCount : state.totalCount || groupRowCount;
    case 'sum':
      return state.validCount > 0 ? state.sum : null;
    case 'avg':
      return state.validCount > 0 ? state.sum / state.validCount : null;
    case 'min':
      return state.validCount > 0 ? state.minValue ?? null : null;
    case 'max':
      return state.validCount > 0 ? state.maxValue ?? null : null;
    default:
      return null;
  }
};

const finaliseGroup = (group: GroupAccumulator): GroupingRow => {
  const aggregates: Record<string, unknown> = {};

  for (const aggregator of group.aggregators) {
    aggregates[aggregator.alias] = finaliseAggregatorValue(aggregator, group.rowCount);
  }

  return {
    key: group.keyValues.length === 1 ? group.keyValues[0] : group.keyValues.slice(),
    rowCount: group.rowCount,
    aggregates
  };
};

export const normaliseGroupColumns = (groupBy: string | string[]): string[] => {
  const columns = Array.isArray(groupBy) ? groupBy.filter(Boolean) : [groupBy];
  if (!columns.length) {
    throw new Error('At least one column must be provided for grouping.');
  }

  return columns;
};

export const paginateGroupingRows = (
  rows: GroupingRow[],
  offset?: number,
  limit?: number
): GroupingRow[] => {
  const start = Math.max(0, offset ?? 0);
  if (limit == null) {
    return rows.slice(start);
  }

  const safeLimit = Math.max(0, limit);
  if (safeLimit === 0) {
    return [];
  }

  return rows.slice(start, start + safeLimit);
};

export const groupMaterializedRows = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  request: GroupingRequest
): GroupingResult => {
  const groupColumns = normaliseGroupColumns(request.groupBy);
  const aggregations =
    request.aggregations && request.aggregations.length > 0
      ? request.aggregations
      : DEFAULT_AGGREGATIONS;

  const templates = aggregations.map((definition) => createTemplate(definition, columnTypes));
  const groups = new Map<string, GroupAccumulator>();

  for (const row of rows) {
    const keyValues = groupColumns.map((column) => row[column]);
    const keySignature = buildGroupSignature(keyValues);
    let accumulator = groups.get(keySignature);

    if (!accumulator) {
      accumulator = {
        keySignature,
        keyValues,
        rowCount: 0,
        aggregators: templates.map(cloneTemplateState)
      };
      groups.set(keySignature, accumulator);
    }

    accumulator.rowCount += 1;

    for (const aggregator of accumulator.aggregators) {
      updateAggregatorState(aggregator, row);
    }
  }

  const totalRows = rows.length;
  const totalGroups = groups.size;
  const groupRows = Array.from(groups.values(), finaliseGroup);

  return {
    groupBy: groupColumns,
    rows: paginateGroupingRows(groupRows, request.offset, request.limit),
    totalGroups,
    totalRows
  };
};
