import { describe, expect, it } from 'vitest';

import { buildFilterExpression } from './filterExpression';
import type { FilterExpression, FilterPredicate } from '@workers/types';
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
    expect(((expression as FilterExpression).predicates[0] as FilterPredicate).value).toBeNull();
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
    expect(((expression as FilterExpression).predicates[0] as FilterPredicate).value).toBe('label-1');
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
    expect((expression as FilterExpression).op).toBe('and');
    expect((expression as FilterExpression).predicates).toHaveLength(2);
    expect((expression as FilterExpression).predicates[0]).toMatchObject({
      id: '1',
      column: 'name',
      operator: 'eq',
      value: 'Alice',
      caseSensitive: false,
      fuzzy: undefined
    } satisfies Partial<FilterPredicate>);
    expect((expression as FilterExpression).predicates[1]).toMatchObject({
      id: '2',
      column: 'age',
      operator: 'gt',
      value: 25,
      caseSensitive: false,
      fuzzy: undefined
    } satisfies Partial<FilterPredicate>);
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
    expect((expression as FilterExpression).predicates[0]).toMatchObject({
      id: '1',
      column: 'age',
      operator: 'between',
      value: 20,
      value2: 30,
      caseSensitive: false,
      fuzzy: undefined
    } satisfies Partial<FilterPredicate>);
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
    expect((expression as FilterExpression).predicates[0]).toMatchObject({
      id: '1',
      column: 'name',
      operator: 'contains',
      value: 'test',
      caseSensitive: true,
      fuzzy: true
    } satisfies Partial<FilterPredicate>);
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
    expect((expression as FilterExpression).op).toBe('and');
    expect((expression as FilterExpression).predicates).toHaveLength(2);
    expect(((expression as FilterExpression).predicates[0] as FilterPredicate).operator).toBe('gt');
    expect(((expression as FilterExpression).predicates[0] as FilterPredicate).value).toBe(80);
    expect(((expression as FilterExpression).predicates[1] as FilterPredicate).operator).toBe('lt');
    expect(((expression as FilterExpression).predicates[1] as FilterPredicate).value).toBe('2023-01-01');
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
    expect(((expression as FilterExpression).predicates[0] as FilterPredicate).column).toBeUndefined();
    expect(((expression as FilterExpression).predicates[0] as FilterPredicate).operator).toBe('eq');
    expect(((expression as FilterExpression).predicates[0] as FilterPredicate).value).toBe('test');
  });

  it('serializes fuzzy distance overrides when explicitly enabled', () => {
    const expression = buildFilterExpression([
      {
        id: 'fuzzy-1',
        column: 'message',
        operator: 'eq',
        value: 'login sucess',
        fuzzy: true,
        fuzzyExplicit: true,
        fuzzyDistance: 3,
        fuzzyDistanceExplicit: true
      }
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect((expression as FilterExpression).predicates[0]).toMatchObject({
      column: 'message',
      operator: 'eq',
      value: 'login sucess',
      fuzzy: true,
      fuzzyDistance: 3
    } satisfies Partial<FilterPredicate>);
  });
});
