import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbMvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbEhWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbCoiWasm from '@duckdb/duckdb-wasm/dist/duckdb-coi.wasm?url';
import duckdbMvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdbEhWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import duckdbCoiWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-coi.worker.js?url';
import duckdbPthreadWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-coi.pthread.worker.js?url';

import type { ColumnType, GroupingRequest, GroupingResult, GroupingRow } from './types';
import type { MaterializedRow } from './utils/materializeRowBatch';
import {
  normaliseGroupColumns,
  paginateGroupingRows,
  resolveAggregationAlias
} from './groupEngine';

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdbMvpWasm,
    mainWorker: duckdbMvpWorker
  },
  eh: {
    mainModule: duckdbEhWasm,
    mainWorker: duckdbEhWorker
  },
  coi: {
    mainModule: duckdbCoiWasm,
    mainWorker: duckdbCoiWorker,
    pthreadWorker: duckdbPthreadWorker
  }
};

let duckDbAvailability: 'unknown' | 'available' | 'unavailable' = 'unknown';

const toModuleUrl = (path?: string | null): string | undefined => {
  if (!path) {
    return undefined;
  }

  try {
    return new URL(path, import.meta.url).toString();
  } catch {
    return path;
  }
};

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
    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    if (!bundle || !bundle.mainWorker || !bundle.mainModule) {
      duckDbAvailability = 'unavailable';
      return null;
    }

    const workerUrl = toModuleUrl(bundle.mainWorker);
    if (!workerUrl) {
      duckDbAvailability = 'unavailable';
      return null;
    }

    const worker = new Worker(workerUrl, { type: 'module' });
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    const mainModuleUrl = toModuleUrl(bundle.mainModule) ?? bundle.mainModule;
    const pthreadWorkerUrl = toModuleUrl(bundle.pthreadWorker);
    await db.instantiate(mainModuleUrl, pthreadWorkerUrl);
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
