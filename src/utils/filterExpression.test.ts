import { describe, expect, it } from 'vitest';

import { buildFilterExpression } from './filterExpression';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from '@workers/types';

describe('buildFilterExpression', () => {
  it('returns null when no filters provided', () => {
    expect(buildFilterExpression([])).toBeNull();
  });

  it('converts no-label sentinel to null for tag column', () => {
    const expression = buildFilterExpression([
      {
        id: '1',
        column: TAG_COLUMN_ID,
        operator: 'eq',
        value: TAG_NO_LABEL_FILTER_VALUE
      }
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect(expression.predicates[0]?.value).toBeNull();
  });

  it('retains label id values for tag column filters', () => {
    const expression = buildFilterExpression([
      {
        id: '1',
        column: TAG_COLUMN_ID,
        operator: 'eq',
        value: 'label-1'
      }
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect(expression.predicates[0]?.value).toBe('label-1');
  });

  it('combines multiple filters with AND logic', () => {
    const expression = buildFilterExpression([
      {
        id: '1',
        column: 'name',
        operator: 'eq',
        value: 'Alice'
      },
      {
        id: '2',
        column: 'age',
        operator: 'gt',
        value: 25
      }
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect(expression.op).toBe('and');
    expect(expression.predicates).toHaveLength(2);
    expect(expression.predicates[0]).toEqual({
      column: 'name',
      operator: 'eq',
      value: 'Alice',
      value2: undefined,
      caseSensitive: false,
      fuzzy: undefined
    });
    expect(expression.predicates[1]).toEqual({
      column: 'age',
      operator: 'gt',
      value: 25,
      value2: undefined,
      caseSensitive: false,
      fuzzy: undefined
    });
  });

  it('handles range operator with value2', () => {
    const expression = buildFilterExpression([
      {
        id: '1',
        column: 'age',
        operator: 'between',
        value: 20,
        value2: 30
      }
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect(expression.predicates[0]).toEqual({
      column: 'age',
      operator: 'between',
      value: 20,
      value2: 30,
      caseSensitive: false,
      fuzzy: undefined
    });
  });

  it('preserves fuzzy and caseSensitive flags', () => {
    const expression = buildFilterExpression([
      {
        id: '1',
        column: 'name',
        operator: 'contains',
        value: 'test',
        fuzzy: true,
        caseSensitive: true
      }
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect(expression.predicates[0]).toEqual({
      column: 'name',
      operator: 'contains',
      value: 'test',
      value2: undefined,
      caseSensitive: true,
      fuzzy: true
    });
  });

  it('handles different operators like gt and lt', () => {
    const expression = buildFilterExpression([
      {
        id: '1',
        column: 'score',
        operator: 'gt',
        value: 80
      },
      {
        id: '2',
        column: 'date',
        operator: 'lt',
        value: '2023-01-01'
      }
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect(expression.op).toBe('and');
    expect(expression.predicates).toHaveLength(2);
    expect(expression.predicates[0].operator).toBe('gt');
    expect(expression.predicates[0].value).toBe(80);
    expect(expression.predicates[1].operator).toBe('lt');
    expect(expression.predicates[1].value).toBe('2023-01-01');
  });

  it('handles malformed filter without required fields', () => {
    const expression = buildFilterExpression([
      {
        id: '1',
        operator: 'eq',
        value: 'test'
      } as any // missing column
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect(expression.predicates[0].column).toBeUndefined();
    expect(expression.predicates[0].operator).toBe('eq');
    expect(expression.predicates[0].value).toBe('test');
  });
});
