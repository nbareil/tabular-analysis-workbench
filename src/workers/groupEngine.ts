import type { RowBatchStore } from './rowBatchStore';
import type {
  ColumnType,
  GroupAggregationDefinition,
  GroupingRequest,
  GroupingResult,
  GroupingRow
} from './types';
import { parseBoolean, parseDatetime, parseNumber } from './valueParsing';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface Aggregator {
  alias: string;
  definition: GroupAggregationDefinition;
  type: ColumnType;
  count: number;
  sum: number;
  extremeKey: number | string | null;
  extremeRaw: string | null;
}

interface GroupAccumulator {
  key: Array<string | null>;
  rowCount: number;
  aggregators: Aggregator[];
}

export const resolveAggregationAlias = (definition: GroupAggregationDefinition): string => {
  if (definition.alias) {
    return definition.alias;
  }
  if (definition.operator === 'count' && !definition.column) {
    return 'count';
  }
  return `${definition.operator}(${definition.column ?? '*'})`;
};

export const normaliseGroupColumns = (groupBy: string | string[]): string[] => {
  const columns = Array.isArray(groupBy) ? groupBy.filter(Boolean) : [groupBy];
  if (!columns.length) {
    throw new Error('At least one column must be provided for grouping.');
  }
  return columns;
};

const comparableKey = (type: ColumnType, raw: string): number | string | null => {
  switch (type) {
    case 'number':
      return parseNumber(raw);
    case 'datetime':
      return parseDatetime(raw);
    case 'boolean': {
      const parsed = parseBoolean(raw);
      return parsed == null ? null : Number(parsed);
    }
    default:
      return raw.trim() === '' ? null : raw;
  }
};

const isBefore = (left: number | string, right: number | string): boolean =>
  typeof left === 'number' && typeof right === 'number' ? left < right : collator.compare(String(left), String(right)) < 0;

const update = (aggregator: Aggregator, raw: string | undefined): void => {
  const { operator } = aggregator.definition;
  if (raw === undefined) {
    if (operator === 'count') {
      aggregator.count += 1;
    }
    return;
  }

  if (operator === 'count') {
    if (raw.trim() !== '') {
      aggregator.count += 1;
    }
    return;
  }

  if (operator === 'sum' || operator === 'avg') {
    const value = parseNumber(raw);
    if (value != null) {
      aggregator.sum += value;
      aggregator.count += 1;
    }
    return;
  }

  const key = comparableKey(aggregator.type, raw);
  if (key == null) {
    return;
  }
  aggregator.count += 1;
  const current = aggregator.extremeKey;
  const replace = current == null || (operator === 'min' ? isBefore(key, current) : isBefore(current, key));
  if (replace) {
    aggregator.extremeKey = key;
    aggregator.extremeRaw = raw;
  }
};

const finalise = (aggregator: Aggregator): unknown => {
  switch (aggregator.definition.operator) {
    case 'count':
      return aggregator.count;
    case 'sum':
      return aggregator.count > 0 ? aggregator.sum : null;
    case 'avg':
      return aggregator.count > 0 ? aggregator.sum / aggregator.count : null;
    default:
      return aggregator.extremeRaw;
  }
};

/**
 * Groups the rows selected by `rowMask` (all rows when null) by the raw text of the group columns,
 * streaming batch by batch so memory stays proportional to the number of groups.
 */
export const groupRows = async (
  batchStore: RowBatchStore,
  rowMask: Uint8Array | null,
  columnTypes: Record<string, ColumnType>,
  request: GroupingRequest,
  checkCancelled: () => void = () => undefined
): Promise<GroupingResult> => {
  const groupColumns = normaliseGroupColumns(request.groupBy);
  const definitions: GroupAggregationDefinition[] = request.aggregations?.length
    ? request.aggregations
    : [{ operator: 'count', alias: 'count' }];
  const groups = new Map<string, GroupAccumulator>();
  let totalRows = 0;

  for await (const view of batchStore.iterateBatches()) {
    checkCancelled();
    const keyColumns = groupColumns.map((column) => view.column(column));
    const valueColumns = definitions.map((definition) =>
      definition.column ? view.column(definition.column) : null
    );

    for (let index = 0; index < view.rowCount; index += 1) {
      if (rowMask && rowMask[view.rowStart + index] !== 1) {
        continue;
      }
      totalRows += 1;
      const key = keyColumns.map((values) => (values[index]!.trim() === '' ? null : values[index]!));
      const signature = JSON.stringify(key);
      let group = groups.get(signature);
      if (!group) {
        group = {
          key,
          rowCount: 0,
          aggregators: definitions.map((definition) => ({
            alias: resolveAggregationAlias(definition),
            definition,
            type: definition.column ? (columnTypes[definition.column] ?? 'string') : 'string',
            count: 0,
            sum: 0,
            extremeKey: null,
            extremeRaw: null
          }))
        };
        groups.set(signature, group);
      }
      group.rowCount += 1;
      group.aggregators.forEach((aggregator, aggregatorIndex) => {
        update(aggregator, valueColumns[aggregatorIndex]?.[index]);
      });
    }
  }

  const rows: GroupingRow[] = Array.from(groups.values(), (group) => ({
    key: group.key.length === 1 ? group.key[0] : group.key,
    rowCount: group.rowCount,
    aggregates: Object.fromEntries(group.aggregators.map((aggregator) => [aggregator.alias, finalise(aggregator)]))
  }));

  const start = Math.max(0, request.offset ?? 0);
  return {
    groupBy: groupColumns,
    rows: request.limit == null ? rows.slice(start) : rows.slice(start, start + Math.max(0, request.limit)),
    totalGroups: groups.size,
    totalRows
  };
};
