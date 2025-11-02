import { describe, it, expect } from 'vitest';

import type { FilterState } from '@state/sessionStore';
import type { ColumnState } from 'ag-grid-community';

import { evaluateFilterMenuMetadata, buildSortStateFromColumnState } from './DataGrid';

describe('evaluateFilterMenuMetadata', () => {
  it('marks equality as matching when exact predicate already exists', () => {
    const filters: FilterState[] = [
      {
        id: 'eq-1',
        column: 'name',
        operator: 'eq',
        value: 'Alice'
      }
    ];

    const metadata = evaluateFilterMenuMetadata(filters, 'name', 'Alice');

    expect(metadata.eqIndex).toBe(0);
    expect(metadata.eqMatchesValue).toBe(true);
    expect(metadata.neqExists).toBe(false);
  });

  it('treats equality with fuzzy flag as not matching so it can be updated', () => {
    const filters: FilterState[] = [
      {
        id: 'eq-1',
        column: 'name',
        operator: 'eq',
        value: 'Alice',
        fuzzy: true
      }
    ];

    const metadata = evaluateFilterMenuMetadata(filters, 'name', 'Alice');

    expect(metadata.eqIndex).toBe(0);
    expect(metadata.eqMatchesValue).toBe(false);
  });

  it('detects existing inequality predicate for the same value', () => {
    const filters: FilterState[] = [
      {
        id: 'neq-1',
        column: 'name',
        operator: 'neq',
        value: 'Alice'
      }
    ];

    const metadata = evaluateFilterMenuMetadata(filters, 'name', 'Alice');

    expect(metadata.eqIndex).toBe(-1);
    expect(metadata.eqMatchesValue).toBe(false);
    expect(metadata.neqExists).toBe(true);
  });

  it('returns defaults when no predicates exist on the column', () => {
    const filters: FilterState[] = [];

    const metadata = evaluateFilterMenuMetadata(filters, 'name', 'Alice');

    expect(metadata.eqIndex).toBe(-1);
    expect(metadata.eqMatchesValue).toBe(false);
    expect(metadata.neqExists).toBe(false);
  });
});

describe('buildSortStateFromColumnState', () => {
  it('extracts ordered sort definitions for active columns', () => {
    const columnState: ColumnState[] = [
      { colId: 'name', sort: 'asc', sortIndex: 0 },
      { colId: 'age', sort: 'desc', sortIndex: 1 },
      { colId: 'unused', sort: null }
    ];

    expect(buildSortStateFromColumnState(columnState)).toEqual([
      { column: 'name', direction: 'asc' },
      { column: 'age', direction: 'desc' }
    ]);
  });

  it('ignores columns without identifiers', () => {
    const columnState = [
      { colId: undefined, sort: 'asc', sortIndex: 0 },
      { colId: 'status', sort: 'desc', sortIndex: 1 }
    ] as unknown as ColumnState[];

    expect(buildSortStateFromColumnState(columnState)).toEqual([
      { column: 'status', direction: 'desc' }
    ]);
  });
});
