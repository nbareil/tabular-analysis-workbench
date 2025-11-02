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
  key: unknown;
  rowCount: number;
  aggregators: GroupAggregatorState[];
}

const DEFAULT_AGGREGATIONS: GroupAggregationDefinition[] = [
  {
    operator: 'count',
    alias: 'count'
  }
];

const buildAlias = (definition: GroupAggregationDefinition): string => {
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
    alias: buildAlias(definition),
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
    key: group.key,
    rowCount: group.rowCount,
    aggregates
  };
};

export const groupMaterializedRows = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  request: GroupingRequest
): GroupingResult => {
  if (!request.groupBy) {
    throw new Error('groupBy column must be provided for grouping requests.');
  }

  const aggregations =
    request.aggregations && request.aggregations.length > 0
      ? request.aggregations
      : DEFAULT_AGGREGATIONS;

  const templates = aggregations.map((definition) => createTemplate(definition, columnTypes));
  const groups = new Map<unknown, GroupAccumulator>();

  for (const row of rows) {
    const key = row[request.groupBy];
    let accumulator = groups.get(key);

    if (!accumulator) {
      accumulator = {
        key,
        rowCount: 0,
        aggregators: templates.map(cloneTemplateState)
      };
      groups.set(key, accumulator);
    }

    accumulator.rowCount += 1;

    for (const aggregator of accumulator.aggregators) {
      updateAggregatorState(aggregator, row);
    }
  }

  const totalRows = rows.length;
  const totalGroups = groups.size;
  const groupRows = Array.from(groups.values(), finaliseGroup);

  const offset = Math.max(0, request.offset ?? 0);
  const limit = request.limit != null ? Math.max(0, request.limit) : null;

  const sliced =
    limit == null ? groupRows.slice(offset) : groupRows.slice(offset, offset + limit);

  return {
    groupBy: request.groupBy,
    rows: sliced,
    totalGroups,
    totalRows
  };
};
