import { describe, expect, it } from 'vitest';

import { groupMaterializedRows } from './groupEngine';
import type { MaterializedRow } from './utils/materializeRowBatch';
import type { ColumnType } from './types';

describe('groupEngine', () => {
  const baseRows: MaterializedRow[] = [
    { __rowId: 1, category: 'A', amount: 10 },
    { __rowId: 2, category: 'A', amount: null },
    { __rowId: 3, category: 'B', amount: 5 }
  ];

  const numberColumnTypes: Record<string, ColumnType> = {
    category: 'string',
    amount: 'number'
  };

  it('groups rows and calculates numeric aggregates', () => {
    const result = groupMaterializedRows(baseRows, numberColumnTypes, {
      groupBy: 'category',
      aggregations: [
        { operator: 'count', alias: 'totalCount' },
        { operator: 'count', column: 'amount', alias: 'valueCount' },
        { operator: 'sum', column: 'amount', alias: 'sumAmount' },
        { operator: 'min', column: 'amount', alias: 'minAmount' },
        { operator: 'max', column: 'amount', alias: 'maxAmount' },
        { operator: 'avg', column: 'amount', alias: 'avgAmount' }
      ]
    });

    expect(result.groupBy).toEqual(['category']);
    expect(result.totalRows).toBe(3);
    expect(result.totalGroups).toBe(2);
    expect(result.rows).toHaveLength(2);

    const firstGroup = result.rows[0]!;
    expect(firstGroup.key).toBe('A');
    expect(firstGroup.rowCount).toBe(2);
    expect(firstGroup.aggregates.totalCount).toBe(2);
    expect(firstGroup.aggregates.valueCount).toBe(1);
    expect(firstGroup.aggregates.sumAmount).toBe(10);
    expect(firstGroup.aggregates.minAmount).toBe(10);
    expect(firstGroup.aggregates.maxAmount).toBe(10);
    expect(firstGroup.aggregates.avgAmount).toBe(10);

    const secondGroup = result.rows[1]!;
    expect(secondGroup.key).toBe('B');
    expect(secondGroup.rowCount).toBe(1);
    expect(secondGroup.aggregates.totalCount).toBe(1);
    expect(secondGroup.aggregates.valueCount).toBe(1);
    expect(secondGroup.aggregates.sumAmount).toBe(5);
    expect(secondGroup.aggregates.minAmount).toBe(5);
    expect(secondGroup.aggregates.maxAmount).toBe(5);
    expect(secondGroup.aggregates.avgAmount).toBe(5);
  });

  it('respects offset and limit when slicing groups', () => {
    const result = groupMaterializedRows(baseRows, numberColumnTypes, {
      groupBy: 'category',
      aggregations: [{ operator: 'count', alias: 'totalCount' }],
      offset: 1,
      limit: 1
    });

    expect(result.groupBy).toEqual(['category']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.key).toBe('B');
    expect(result.rows[0]!.aggregates.totalCount).toBe(1);
  });

  it('handles string based min aggregate', () => {
    const rows: MaterializedRow[] = [
      { __rowId: 1, category: 'A', tag: 'delta' },
      { __rowId: 2, category: 'A', tag: 'alpha' },
      { __rowId: 3, category: 'B', tag: 'gamma' }
    ];

    const columnTypes: Record<string, ColumnType> = {
      category: 'string',
      tag: 'string'
    };

    const result = groupMaterializedRows(rows, columnTypes, {
      groupBy: 'category',
      aggregations: [{ operator: 'min', column: 'tag', alias: 'minTag' }]
    });

    expect(result.groupBy).toEqual(['category']);
    expect(result.rows[0]!.aggregates.minTag).toBe('alpha');
    expect(result.rows[1]!.aggregates.minTag).toBe('gamma');
  });

  it('returns null aggregates when column data is unavailable', () => {
    const result = groupMaterializedRows(baseRows, numberColumnTypes, {
      groupBy: 'category',
      aggregations: [{ operator: 'sum', column: 'missing', alias: 'missingSum' }]
    });

    expect(result.groupBy).toEqual(['category']);
    expect(result.rows[0]!.aggregates.missingSum).toBeNull();
    expect(result.rows[1]!.aggregates.missingSum).toBeNull();
  });

  it('supports multi-column grouping keys', () => {
    const rows: MaterializedRow[] = [
      { __rowId: 1, category: 'A', region: 'EMEA', amount: 1 },
      { __rowId: 2, category: 'A', region: 'EMEA', amount: 2 },
      { __rowId: 3, category: 'A', region: 'NA', amount: 3 },
      { __rowId: 4, category: 'B', region: 'NA', amount: 4 }
    ];

    const columnTypes: Record<string, ColumnType> = {
      category: 'string',
      region: 'string',
      amount: 'number'
    };

    const result = groupMaterializedRows(rows, columnTypes, {
      groupBy: ['category', 'region'],
      aggregations: [
        { operator: 'count', alias: 'totalCount' },
        { operator: 'sum', column: 'amount', alias: 'sumAmount' }
      ]
    });

    expect(result.groupBy).toEqual(['category', 'region']);
    expect(result.totalGroups).toBe(3);

    const keys = result.rows.map((entry) => entry.key);
    expect(keys).toContainEqual(['A', 'EMEA']);
    expect(keys).toContainEqual(['A', 'NA']);
    expect(keys).toContainEqual(['B', 'NA']);
  });
});
