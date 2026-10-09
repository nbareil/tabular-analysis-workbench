import { describe, expect, it } from 'vitest';

import { compileFilter, compileRegex, evaluateFilterOnBatch, FilterError } from './filterEngine';
import type { BatchView } from './rowBatchStore';
import type { ColumnType, FilterNode, TagRecord } from './types';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from './types';

const view = (columns: Record<string, string[]>, rowStart = 0): BatchView => {
  const rowCount = Object.values(columns)[0]!.length;
  return {
    rowStart,
    rowCount,
    column: (name) => columns[name] ?? new Array<string>(rowCount).fill('')
  };
};

const columns = {
  name: ['Alice', ' bob ', 'Carol', '', 'Ｃarol', 'café'],
  amount: ['10', '2.5', 'n/a', '', '100', '-3'],
  seen: ['2024-01-01T00:00:00Z', '2024-01-02 00:00', '', 'garbage', '2024-01-01 12:00:00+02:00', '1704067200'],
  active: ['yes', 'no', 'TRUE', '', 'n', '1']
};
const types: Record<string, ColumnType> = { name: 'string', amount: 'number', seen: 'datetime', active: 'boolean' };

const run = (expression: FilterNode, tags: Record<number, TagRecord> = {}, data = columns): number[] => {
  const mask = evaluateFilterOnBatch(compileFilter(expression, types), view(data), tags);
  return Array.from(mask).flatMap((bit, index) => (bit ? [index] : []));
};

describe('text predicates', () => {
  it('compares trimmed, case-insensitive text by default', () => {
    expect(run({ column: 'name', operator: 'eq', value: 'BOB' })).toEqual([1]);
    expect(run({ column: 'name', operator: 'eq', value: 'bob', caseSensitive: true })).toEqual([1]);
    expect(run({ column: 'name', operator: 'eq', value: 'Bob', caseSensitive: true })).toEqual([]);
  });

  it('normalises Unicode composition', () => {
    expect(run({ column: 'name', operator: 'eq', value: 'café' })).toEqual([5]);
  });

  it('supports contains and startsWith', () => {
    expect(run({ column: 'name', operator: 'contains', value: 'ar' })).toEqual([2, 4]);
    expect(run({ column: 'name', operator: 'startsWith', value: 'b' })).toEqual([1]);
  });

  it('makes neq the exact complement of eq, including empty cells', () => {
    const eq = run({ column: 'name', operator: 'eq', value: 'carol' });
    const neq = run({ column: 'name', operator: 'neq', value: 'carol' });
    expect(eq).toEqual([2]);
    expect(neq).toEqual([0, 1, 3, 4, 5]);
  });

  it('applies text operators to typed columns too', () => {
    expect(run({ column: 'amount', operator: 'contains', value: '0' })).toEqual([0, 4]);
  });
});

describe('regex predicates', () => {
  it('matches raw text and negates with notMatches', () => {
    expect(run({ column: 'name', operator: 'matches', value: '^c' })).toEqual([2, 5]);
    expect(run({ column: 'name', operator: 'notMatches', value: '^c' })).toEqual([0, 1, 3, 4]);
    expect(run({ column: 'name', operator: 'regex', value: '^C', caseSensitive: true })).toEqual([2]);
  });

  it('rejects invalid patterns and nested quantifiers with FilterError', () => {
    expect(() => compileFilter({ column: 'name', operator: 'regex', value: '(' }, types)).toThrow(FilterError);
    expect(() => compileRegex('(a+)+$', false)).toThrow(FilterError);
    expect(() => compileRegex('(\\w*)*', false)).toThrow(FilterError);
    expect(() => compileRegex('(ab)+', false)).not.toThrow();
  });

  it('supports Unicode property escapes', () => {
    expect(compileRegex('^\\p{Lu}', true).test('Alice')).toBe(true);
  });
});

describe('typed predicates', () => {
  it('compares numbers by value and ignores unparseable cells for ranges', () => {
    expect(run({ column: 'amount', operator: 'eq', value: '10.0' })).toEqual([0]);
    expect(run({ column: 'amount', operator: 'gt', value: 2.5 })).toEqual([0, 4]);
    expect(run({ column: 'amount', operator: 'lt', value: '2.5' })).toEqual([5]);
    expect(run({ column: 'amount', operator: 'between', value: '2.5', value2: '10' })).toEqual([0, 1]);
  });

  it('treats blank range bounds as open', () => {
    expect(run({ column: 'amount', operator: 'range', value: '', value2: '5' })).toEqual([1, 5]);
    expect(run({ column: 'amount', operator: 'between', value: '5', value2: '  ' })).toEqual([0, 4]);
    expect(run({ column: 'amount', operator: 'range', value: null, value2: undefined })).toEqual([0, 1, 4, 5]);
  });

  it('includes empty and unparseable cells in numeric neq', () => {
    expect(run({ column: 'amount', operator: 'neq', value: 10 })).toEqual([1, 2, 3, 4, 5]);
  });

  it('compares datetimes in UTC across formats and zones', () => {
    expect(run({ column: 'seen', operator: 'eq', value: '2024-01-01' })).toEqual([0, 5]);
    expect(run({ column: 'seen', operator: 'between', value: '2024-01-01 10:00', value2: '2024-01-01T10:00Z' })).toEqual([4]);
    expect(run({ column: 'seen', operator: 'gt', value: '2024-01-01T10:00:00Z' })).toEqual([1]);
    expect(run({ column: 'seen', operator: 'range', value: Date.UTC(2024, 0, 2) })).toEqual([1]);
  });

  it('matches booleans by meaning, not text, and does not treat 1 as true', () => {
    expect(run({ column: 'active', operator: 'eq', value: true })).toEqual([0, 2]);
    expect(run({ column: 'active', operator: 'eq', value: 'false' })).toEqual([1, 4]);
    expect(run({ column: 'active', operator: 'neq', value: true })).toEqual([1, 3, 4, 5]);
  });

  it('rejects range operators on text columns', () => {
    for (const operator of ['gt', 'lt', 'range', 'between'] as const) {
      expect(() => compileFilter({ column: 'name', operator, value: 1 }, types)).toThrow(FilterError);
    }
  });

  it('rejects unknown operators', () => {
    expect(() => compileFilter({ column: 'name', operator: 'bogus' as never, value: 1 }, types)).toThrow(FilterError);
  });
});

describe('label predicates', () => {
  const tags: Record<number, TagRecord> = {
    0: { labelIds: ['red'], updatedAt: 0 },
    2: { labelIds: ['red', 'blue'], updatedAt: 0 },
    3: { labelIds: [], note: 'note only', updatedAt: 0 }
  };

  it('filters rows by label, by absence of labels, and by negation', () => {
    expect(run({ column: TAG_COLUMN_ID, operator: 'eq', value: 'red' }, tags)).toEqual([0, 2]);
    expect(run({ column: TAG_COLUMN_ID, operator: 'neq', value: 'red' }, tags)).toEqual([1, 3, 4, 5]);
    expect(run({ column: TAG_COLUMN_ID, operator: 'eq', value: TAG_NO_LABEL_FILTER_VALUE }, tags)).toEqual([1, 3, 4, 5]);
    expect(run({ column: TAG_COLUMN_ID, operator: 'neq', value: null }, tags)).toEqual([0, 2]);
  });

  it('uses absolute row ids for batches after the first', () => {
    const compiled = compileFilter({ column: TAG_COLUMN_ID, operator: 'eq', value: 'x' }, types);
    const mask = evaluateFilterOnBatch(compiled, view({ name: ['a', 'b'] }, 10), { 11: { labelIds: ['x'], updatedAt: 0 } });
    expect(Array.from(mask)).toEqual([0, 1]);
  });

  it('rejects text operators on labels', () => {
    expect(() => compileFilter({ column: TAG_COLUMN_ID, operator: 'contains', value: 'r' }, types)).toThrow(FilterError);
  });
});

describe('expressions', () => {
  it('combines nested and/or groups', () => {
    const expression: FilterNode = {
      op: 'or',
      predicates: [
        { column: 'name', operator: 'eq', value: 'alice' },
        {
          op: 'and',
          predicates: [
            { column: 'amount', operator: 'gt', value: 0 },
            { column: 'active', operator: 'eq', value: false }
          ]
        }
      ]
    };
    expect(run(expression)).toEqual([0, 1, 4]);
  });

  it('matches everything for an empty group', () => {
    expect(run({ op: 'and', predicates: [] })).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('accumulates per-predicate match counts across batches', () => {
    const compiled = compileFilter(
      {
        op: 'and',
        predicates: [
          { id: 'p1', column: 'name', operator: 'contains', value: 'a' },
          { id: 'p2', column: 'amount', operator: 'gt', value: 5 }
        ]
      },
      types
    );
    const counts: Record<string, number> = {};
    evaluateFilterOnBatch(compiled, view({ name: ['a', 'b'], amount: ['10', '10'] }), {}, counts);
    evaluateFilterOnBatch(compiled, view({ name: ['a', 'a'], amount: ['1', '10'] }, 2), {}, counts);
    expect(counts).toEqual({ p1: 3, p2: 3 });
  });
});
