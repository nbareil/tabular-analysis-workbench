import type { ColumnType, FilterNode } from './types';
import type { MaterializedRow } from './utils/materializeRowBatch';
import { evaluateFilterOnRows, type FilterEvaluationContext } from './filterEngine';

export interface SearchRequest {
  query: string;
  columns: string[];
  filter?: FilterNode | null;
  limit?: number;
  caseSensitive?: boolean;
}

export interface SearchResult {
  rows: MaterializedRow[];
  totalRows: number;
  matchedRows: number;
}

const normalise = (value: unknown, caseSensitive: boolean): string => {
  const stringValue = String(value ?? '');
  return caseSensitive ? stringValue : stringValue.toLowerCase();
};

export const searchRows = (
  rows: MaterializedRow[],
  columnTypes: Record<string, ColumnType>,
  request: SearchRequest,
  context: FilterEvaluationContext = {}
): SearchResult => {
  const { query, columns, filter, limit, caseSensitive } = request;
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      rows: rows.slice(0, limit ?? 500),
      totalRows: rows.length,
      matchedRows: rows.length
    };
  }

  const haystackColumns = columns.length > 0 ? columns : Object.keys(columnTypes);
  const searchableColumns = haystackColumns.filter((column) => columnTypes[column] != null);

  let workingRows = rows;

  if (filter) {
    const { matches } = evaluateFilterOnRows(rows, columnTypes, filter, context);
    workingRows = rows.filter((_, index) => matches[index] === 1);
  }

  const enforceCaseSensitive = Boolean(caseSensitive);
  const needle = normalise(trimmed, enforceCaseSensitive);
  const matched: MaterializedRow[] = [];

  for (const row of workingRows) {
    const found = searchableColumns.some((column) =>
      normalise(row[column], enforceCaseSensitive).includes(needle)
    );
    if (found) {
      matched.push(row);
      if (limit && matched.length >= limit) {
        break;
      }
    }
  }

  return {
    rows: matched,
    totalRows: rows.length,
    matchedRows: matched.length
  };
};
