import { describe, expect, it } from 'vitest';

import { searchRows } from './searchEngine';
import type { ColumnType } from './types';
import type { MaterializedRow } from './utils/materializeRowBatch';

describe('searchEngine', () => {
  const rows: MaterializedRow[] = [
    { __rowId: 1, message: 'Error initialised', severity: 'High' },
    { __rowId: 2, message: 'warning raised', severity: 'Medium' },
    { __rowId: 3, message: 'error resolved', severity: 'Low' }
  ];

  const columnTypes: Record<string, ColumnType> = {
    message: 'string',
    severity: 'string'
  };

  it('performs case-insensitive search by default', () => {
    const result = searchRows(rows, columnTypes, {
      query: 'error',
      columns: ['message']
    });

    expect(result.matchedRows).toBe(2);
    expect(result.rows.map((row) => row.__rowId)).toEqual([1, 3]);
  });

  it('honours case-sensitive search when requested', () => {
    const result = searchRows(rows, columnTypes, {
      query: 'error',
      columns: ['message'],
      caseSensitive: true
    });

    expect(result.matchedRows).toBe(1);
    expect(result.rows.map((row) => row.__rowId)).toEqual([3]);
  });
});
