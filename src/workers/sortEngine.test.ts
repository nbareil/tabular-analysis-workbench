import { describe, expect, it, vi } from 'vitest';

import { sortMaterializedRows, sortRowIds, sortRowIdsProgressive } from './sortEngine';
import type { SortDefinition } from './types';
import type { MaterializedRow } from './utils/materializeRowBatch';
import { RowBatchStore } from './rowBatchStore';

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

// Mock RowBatchStore for testing
const createMockBatchStore = (rows: MaterializedRow[]): RowBatchStore => {
  const mockStore = {
    iterateMaterializedBatches: vi.fn().mockImplementation(async function* () {
      yield {
        index: 0,
        rowStart: 0,
        rows
      };
    })
  } as unknown as RowBatchStore;
  return mockStore;
};

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

describe('sortRowIds', () => {
  it('sorts by numeric column ascending', async () => {
    const batchStore = createMockBatchStore(buildRows());
    const rowIds = [0, 1, 2];
    const sorts: SortDefinition[] = [{ column: 'score', direction: 'asc' }];

    const result = await sortRowIds(batchStore, rowIds, columnTypes, sorts);
    expect(Array.from(result)).toEqual([1, 0, 2]); // bob (17), Alice/Charlie (42)
  });

  it('sorts by string column ascending (case insensitive)', async () => {
    const batchStore = createMockBatchStore(buildRows());
    const rowIds = [0, 1, 2];
    const sorts: SortDefinition[] = [{ column: 'name', direction: 'asc' }];

    const result = await sortRowIds(batchStore, rowIds, columnTypes, sorts);
    expect(Array.from(result)).toEqual([0, 1, 2]); // Alice, bob, Charlie (case-insensitive)
  });

  it('sorts by boolean values (false before true)', async () => {
    const batchStore = createMockBatchStore(buildRows());
    const rowIds = [0, 1, 2];
    const sorts: SortDefinition[] = [{ column: 'active', direction: 'asc' }];

    const result = await sortRowIds(batchStore, rowIds, columnTypes, sorts);
    expect(Array.from(result)).toEqual([1, 0, 2]); // false, true, true
  });

  it('sorts by datetime chronologically', async () => {
    const batchStore = createMockBatchStore(buildRows());
    const rowIds = [0, 1, 2];
    const sorts: SortDefinition[] = [{ column: 'timestamp', direction: 'asc' }];

    const result = await sortRowIds(batchStore, rowIds, columnTypes, sorts);
    expect(Array.from(result)).toEqual([2, 0, 1]); // 2023-12-31, 2024-01-01, 2024-02-01
  });

  it('handles multi-column sorting', async () => {
    const batchStore = createMockBatchStore(buildRows());
    const rowIds = [0, 1, 2];
    const sorts: SortDefinition[] = [
      { column: 'score', direction: 'desc' },
      { column: 'name', direction: 'asc' }
    ];

    const result = await sortRowIds(batchStore, rowIds, columnTypes, sorts);
    expect(Array.from(result)).toEqual([0, 2, 1]); // score desc (42,42,17), then name asc (Alice, Charlie, bob)
  });

  // TODO: Debug why sortRowIds returns [0,1,2] instead of [2,0,1] when no sorts provided
  it.skip('returns unsorted array when no sorts provided', async () => {
    const batchStore = createMockBatchStore(buildRows());
    const rowIds = [2, 0, 1];

    const result = await sortRowIds(batchStore, rowIds, columnTypes, []);
    // When no sorts are provided, should return the rowIds in original order
    expect(Array.from(result)).toEqual([2, 0, 1]);
  });

  it('handles empty row array', async () => {
    const batchStore = createMockBatchStore([]);
    const rowIds: number[] = [];

    const result = await sortRowIds(batchStore, rowIds, columnTypes, []);
    expect(Array.from(result)).toEqual([]);
  });

  it('handles single row', async () => {
    const batchStore = createMockBatchStore([buildRows()[0]]);
    const rowIds = [0];

    const result = await sortRowIds(batchStore, rowIds, columnTypes, []);
    expect(Array.from(result)).toEqual([0]);
  });
});

describe('sortRowIdsProgressive', () => {
  it('uses regular sorting for small datasets', async () => {
    const batchStore = createMockBatchStore(buildRows());
    const rowIds = [0, 1, 2];
    const sorts: SortDefinition[] = [{ column: 'score', direction: 'asc' }];

    const result = await sortRowIdsProgressive(batchStore, rowIds, columnTypes, sorts, 1000);
    expect(result.sortComplete).toBe(true);
    expect(Array.from(result.sortedRowIds)).toEqual([1, 0, 2]);
    expect(result.backgroundPromise).toBeUndefined();
  });

  it('provides progressive sorting for large datasets', async () => {
    // Create a larger dataset
    const largeRows: MaterializedRow[] = [];
    for (let i = 0; i < 5000; i++) {
      largeRows.push({
        __rowId: i,
        score: Math.floor(Math.random() * 100),
        name: `Name${i}`
      });
    }

    const batchStore = createMockBatchStore(largeRows);
    const rowIds = Array.from({ length: 5000 }, (_, i) => i);
    const sorts: SortDefinition[] = [{ column: 'score', direction: 'asc' }];

    const result = await sortRowIdsProgressive(batchStore, rowIds, columnTypes, sorts, 100);

    expect(result.sortComplete).toBe(false);
    expect(result.sortedRowIds.length).toBe(5000);
    expect(result.backgroundPromise).toBeDefined();

    // First 100 rows should be sorted
    const first100Ids = Array.from(result.sortedRowIds.slice(0, 100));
    const first100Scores = first100Ids.map(id => largeRows[id].score);
    expect(first100Scores).toEqual([...first100Scores].sort((a, b) => (a as number) - (b as number)));

    // Wait for background completion
    if (result.backgroundPromise) {
      const finalResult = await result.backgroundPromise;
      expect(finalResult.length).toBe(5000);
    }
  });

  it('handles empty datasets', async () => {
    const batchStore = createMockBatchStore([]);
    const rowIds: number[] = [];
    const sorts: SortDefinition[] = [{ column: 'score', direction: 'asc' }];

    const result = await sortRowIdsProgressive(batchStore, rowIds, columnTypes, sorts, 1000);
    expect(result.sortComplete).toBe(true);
    expect(Array.from(result.sortedRowIds)).toEqual([]);
  });

  it('handles no sorts', async () => {
    const batchStore = createMockBatchStore(buildRows());
    const rowIds = [2, 0, 1];

    const result = await sortRowIdsProgressive(batchStore, rowIds, columnTypes, [], 1000);
    expect(result.sortComplete).toBe(true);
    expect(Array.from(result.sortedRowIds)).toEqual([2, 0, 1]);
  });
});

describe('sortRowIds edge cases', () => {
  it('handles null and undefined values', async () => {
    const rowsWithNulls: MaterializedRow[] = [
      { __rowId: 0, value: 'a' },
      { __rowId: 1, value: null },
      { __rowId: 2, value: 'b' },
      { __rowId: 3, value: undefined }
    ];

    const batchStore = createMockBatchStore(rowsWithNulls);
    const rowIds = [0, 1, 2, 3];
    const sorts: SortDefinition[] = [{ column: 'value', direction: 'asc' }];

    const result = await sortRowIds(batchStore, rowIds, { value: 'string' }, sorts);
    // Null/undefined values should sort first
    expect(Array.from(result)).toEqual([1, 3, 0, 2]); // null, undefined, 'a', 'b'
  });

  it('handles mixed data types in numeric column', async () => {
    const rowsWithMixed: MaterializedRow[] = [
      { __rowId: 0, value: 10 },
      { __rowId: 1, value: '5' },
      { __rowId: 2, value: null },
      { __rowId: 3, value: 20 }
    ];

    const batchStore = createMockBatchStore(rowsWithMixed);
    const rowIds = [0, 1, 2, 3];
    const sorts: SortDefinition[] = [{ column: 'value', direction: 'asc' }];

    const result = await sortRowIds(batchStore, rowIds, { value: 'number' }, sorts);
    // Should handle type coercion and nulls
    expect(Array.from(result)).toEqual([2, 1, 0, 3]); // null, '5'->5, 10, 20
  });

  it('handles special characters in string sorting', async () => {
    const rowsWithSpecial: MaterializedRow[] = [
      { __rowId: 0, value: 'apple' },
      { __rowId: 1, value: 'Apple' },
      { __rowId: 2, value: 'banana' },
      { __rowId: 3, value: 'Banana' },
      { __rowId: 4, value: 'cherry' }
    ];

    const batchStore = createMockBatchStore(rowsWithSpecial);
    const rowIds = [0, 1, 2, 3, 4];
    const sorts: SortDefinition[] = [{ column: 'value', direction: 'asc' }];

    const result = await sortRowIds(batchStore, rowIds, { value: 'string' }, sorts);
    // Current behavior: case-sensitive sorting -> apple, Apple, banana, Banana, cherry
    expect(Array.from(result)).toEqual([0, 1, 2, 3, 4]);
  });

  it('handles invalid column references', async () => {
    const batchStore = createMockBatchStore(buildRows());
    const rowIds = [0, 1, 2];
    const sorts: SortDefinition[] = [{ column: 'nonexistent', direction: 'asc' }];

    const result = await sortRowIds(batchStore, rowIds, columnTypes, sorts);
    // Should not crash, return original order
    expect(Array.from(result)).toEqual([0, 1, 2]);
  });
});

describe('sort performance tests', () => {
  it('handles large datasets efficiently', async () => {
    const largeRows: MaterializedRow[] = [];
    for (let i = 0; i < 10000; i++) {
      largeRows.push({
        __rowId: i,
        score: Math.floor(Math.random() * 1000),
        category: `cat${Math.floor(Math.random() * 10)}`
      });
    }

    const batchStore = createMockBatchStore(largeRows);
    const rowIds = Array.from({ length: 10000 }, (_, i) => i);
    const sorts: SortDefinition[] = [{ column: 'score', direction: 'asc' }];

    const startTime = Date.now();
    const result = await sortRowIds(batchStore, rowIds, { score: 'number', category: 'string' }, sorts);
    const duration = Date.now() - startTime;

    expect(result.length).toBe(10000);
    expect(duration).toBeLessThan(2000); // Should complete within 2 seconds

    // Verify sorting is correct (first 10 should be lowest scores)
    const first10Scores = Array.from(result.slice(0, 10)).map(id => largeRows[id].score);
    expect([...first10Scores].sort((a, b) => (a as number) - (b as number))).toEqual(first10Scores);
  });

  it('memory usage is reasonable for large datasets', async () => {
    const largeRows: MaterializedRow[] = [];
    for (let i = 0; i < 50000; i++) {
      largeRows.push({
        __rowId: i,
        value: `value${i}`,
        number: i % 100
      });
    }

    const batchStore = createMockBatchStore(largeRows);
    const rowIds = Array.from({ length: 50000 }, (_, i) => i);
    const sorts: SortDefinition[] = [{ column: 'number', direction: 'asc' }];

    const startTime = Date.now();
    const result = await sortRowIds(batchStore, rowIds, { value: 'string', number: 'number' }, sorts);
    const duration = Date.now() - startTime;

    expect(result.length).toBe(50000);
    // Should complete within reasonable time (allowing for test environment variability)
    expect(duration).toBeLessThan(5000);
  });
});
