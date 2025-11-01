import { describe, expect, it } from 'vitest';

import { sortMaterializedRows } from './sortEngine';
import type { SortDefinition } from './types';
import type { MaterializedRow } from './utils/materializeRowBatch';

const buildRows = (): MaterializedRow[] => [
  { __rowId: 0, name: 'Alice', score: 42, active: true, timestamp: new Date('2024-01-01').toISOString() },
  { __rowId: 1, name: 'bob', score: 17, active: false, timestamp: new Date('2024-02-01').toISOString() },
  { __rowId: 2, name: 'Charlie', score: 42, active: true, timestamp: new Date('2023-12-31').toISOString() }
];

const columnTypes = {
  name: 'string',
  score: 'number',
  active: 'boolean',
  timestamp: 'datetime'
} as const;

describe('sortMaterializedRows', () => {
  it('sorts by numeric column ascending', () => {
    const sorts: SortDefinition[] = [{ column: 'score', direction: 'asc' }];
    const result = sortMaterializedRows(buildRows(), columnTypes, sorts);
    expect(result.rows.map((row) => row.__rowId)).toEqual([1, 0, 2]);
  });

  it('sorts by numeric descending then string', () => {
    const sorts: SortDefinition[] = [
      { column: 'score', direction: 'desc' },
      { column: 'name', direction: 'asc' }
    ];
    const result = sortMaterializedRows(buildRows(), columnTypes, sorts);
    expect(result.rows.map((row) => row.__rowId)).toEqual([0, 2, 1]);
  });

  it('sorts boolean values placing false before true', () => {
    const sorts: SortDefinition[] = [{ column: 'active', direction: 'asc' }];
    const result = sortMaterializedRows(buildRows(), columnTypes, sorts);
    expect(result.rows.map((row) => row.__rowId)).toEqual([1, 0, 2]);
  });

  it('sorts datetime values chronologically', () => {
    const sorts: SortDefinition[] = [{ column: 'timestamp', direction: 'asc' }];
    const result = sortMaterializedRows(buildRows(), columnTypes, sorts);
    expect(result.rows.map((row) => row.__rowId)).toEqual([2, 0, 1]);
  });

  it('returns copy when no sorts provided', () => {
    const rows = buildRows();
    const result = sortMaterializedRows(rows, columnTypes, []);
    expect(result.rows).not.toBe(rows);
    expect(result.rows.map((row) => row.__rowId)).toEqual([0, 1, 2]);
  });
});
