import type { ColumnType, GroupingRequest, GroupingResult, GroupingRow } from './types';
import type { MaterializedRow } from './utils/materializeRowBatch';
import {
  normaliseGroupColumns,
  paginateGroupingRows,
  resolveAggregationAlias
} from './groupEngine';

let duckDbAvailability: 'unknown' | 'available' | 'unavailable' = 'unknown';

export const shouldPreferDuckDb = (
  request: GroupingRequest,
  columnTypes: Record<string, ColumnType>,
  rowCount: number
): boolean => {
  const groupColumns = normaliseGroupColumns(request.groupBy);
  if (groupColumns.length > 1) {
    return true;
  }

  if (rowCount > 50_000) {
    return true;
  }

  return request.aggregations.some((aggregation) => {
    if (aggregation.operator === 'avg' || aggregation.operator === 'sum') {
      if (!aggregation.column) {
        return true;
      }

      const type = columnTypes[aggregation.column];
      return type !== 'number';
    }

    return false;
  });
};

export const tryGroupWithDuckDb = async (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  request: GroupingRequest
): Promise<GroupingResult | null> => {
  if (duckDbAvailability === 'unavailable') {
    return null;
  }

  try {
    const module = await import('@duckdb/duckdb-wasm');
    if (!module) {
      duckDbAvailability = 'unavailable';
      return null;
    }

    const bundles =
      typeof module.selectBundle === 'function' && typeof module.getJsDelivrBundles === 'function'
        ? module.getJsDelivrBundles()
        : null;

    if (!bundles) {
      duckDbAvailability = 'unavailable';
      return null;
    }

    const bundle = await module.selectBundle(bundles);
    if (!bundle) {
      duckDbAvailability = 'unavailable';
      return null;
    }

    if (!bundle.mainWorker || !bundle.mainModule) {
      duckDbAvailability = 'unavailable';
      return null;
    }

    const workerSource = bundle.mainWorker;
    const workerUrl =
      workerSource.startsWith('http') || workerSource.startsWith('blob:')
        ? workerSource
        : new URL(workerSource, import.meta.url).toString();

    const worker = new Worker(workerUrl, { type: 'module' });
    const db = new module.AsyncDuckDB(new module.ConsoleLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    duckDbAvailability = 'available';

    const connection = await db.connect();
    try {
      await connection.query('DROP TABLE IF EXISTS __csv_explorer_duckdb');
      const groupColumns = normaliseGroupColumns(request.groupBy);
      const requiredColumns = new Set<string>(groupColumns);

      for (const aggregation of request.aggregations) {
        if (aggregation.column) {
          requiredColumns.add(aggregation.column);
        }
      }

      const columnList = Array.from(requiredColumns);
      const columnDefinitions = columnList
        .map((column) => {
          const type = columnTypes[column];
          switch (type) {
            case 'number':
              return `"${column}" DOUBLE`;
            case 'datetime':
              return `"${column}" TIMESTAMP`;
            case 'boolean':
              return `"${column}" BOOLEAN`;
            case 'string':
            default:
              return `"${column}" VARCHAR`;
          }
        })
        .join(', ');

      await connection.query(
        `CREATE TEMP TABLE __csv_explorer_duckdb (${columnDefinitions})`
      );

      const placeholders = columnList.map(() => '?').join(', ');
      const insertSql = `INSERT INTO __csv_explorer_duckdb (${columnList
        .map((column) => `"${column}"`)
        .join(', ')}) VALUES (${placeholders})`;

      for (const row of rows) {
        const params = columnList.map((column) => row[column] ?? null);
        await connection.query(insertSql, params);
      }

      const selectExpressions = groupColumns.map((column) => `"${column}"`);
      const aggregationExpressions = request.aggregations.map((aggregation, index) => {
        const alias = resolveAggregationAlias({
          ...aggregation,
          alias:
            aggregation.alias ??
            (aggregation.operator === 'count' && !aggregation.column
              ? 'count'
              : `${aggregation.operator}_${aggregation.column ?? index}`)
        });

        switch (aggregation.operator) {
          case 'count':
            return aggregation.column
              ? `COUNT("${aggregation.column}") AS "${alias}"`
              : `COUNT(*) AS "${alias}"`;
          case 'sum':
            return aggregation.column ? `SUM("${aggregation.column}") AS "${alias}"` : null;
          case 'min':
            return aggregation.column ? `MIN("${aggregation.column}") AS "${alias}"` : null;
          case 'max':
            return aggregation.column ? `MAX("${aggregation.column}") AS "${alias}"` : null;
          case 'avg':
            return aggregation.column ? `AVG("${aggregation.column}") AS "${alias}"` : null;
          default:
            return null;
        }
      });

      const filteredAggregations = aggregationExpressions.filter(Boolean) as string[];
      const selectClause = [...selectExpressions, ...filteredAggregations].join(', ');

      const result = await connection.query(
        `SELECT ${selectClause} FROM __csv_explorer_duckdb GROUP BY ${groupColumns
          .map((column) => `"${column}"`)
          .join(', ')}`
      );

      const rowsArray =
        typeof result?.toArray === 'function'
          ? (result.toArray({ format: 'object' }) as Record<string, unknown>[])
          : [];

      const groupingRows = rowsArray.map<GroupingRow>((entry) => {
        const keyValues = groupColumns.map((column) => entry[column]);
        const aggregates: Record<string, unknown> = {};

        for (const aggregation of request.aggregations) {
          const alias = resolveAggregationAlias(aggregation);
          aggregates[alias] = entry[alias];
        }

        let rowCount = rows.length;
        const countAggregation = request.aggregations.find(
          (aggregation) => aggregation.operator === 'count' && !aggregation.column
        );
        if (countAggregation) {
          const alias = resolveAggregationAlias(countAggregation);
          const value = entry[alias];
          if (typeof value === 'number') {
            rowCount = value;
          }
        }

        return {
          key: keyValues.length === 1 ? keyValues[0] : keyValues,
          rowCount,
          aggregates
        };
      });

      return {
        groupBy: groupColumns,
        rows: paginateGroupingRows(groupingRows, request.offset, request.limit),
        totalGroups: groupingRows.length,
        totalRows: rows.length
      };
    } finally {
      await connection.close();
      if (typeof db.terminate === 'function') {
        await db.terminate();
      } else {
        worker.terminate();
      }
    }
  } catch (error) {
    console.warn('[duckdb] Failed to execute fallback plan', error);
    duckDbAvailability = 'unavailable';
    return null;
  }
};
