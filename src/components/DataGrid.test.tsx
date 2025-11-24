import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import type { FilterState } from '@state/sessionStore';
import type { ColumnState, GridApi } from 'ag-grid-community';
import type { ICellRendererParams } from 'ag-grid-community';
import type { TagCellValue } from '@utils/tagCells';

import {
  MarkdownTooltip,
  evaluateFilterMenuMetadata,
  buildSortStateFromColumnState,
  getNextRowIndex,
  toggleRowSelection
} from './DataGrid';

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

describe('MarkdownTooltip', () => {
  const createMockParams = (value: TagCellValue | null): ICellRendererParams<TagCellValue | null> => ({
    value,
    valueFormatted: null as any,
    data: null as any,
    node: null as any,
    colDef: null as any,
    column: null as any,
    rowIndex: 0,
    api: null as any,
    columnApi: null as any,
    context: null,
    eGridCell: null as any,
    eParentOfValue: null as any,
    getValue: () => value,
    setValue: () => {},
    refreshCell: () => {},
    formatValue: () => '',
    registerRowDragger: () => {},
    setTooltip: () => {}
  });

  it('renders markdown note as HTML', () => {
    const mockValue: TagCellValue = {
      rowId: 1,
      labels: [],
      note: '**bold** text and *italic* text',
      updatedAt: Date.now()
    };

    const mockParams = createMockParams(mockValue);
    const { container } = render(<MarkdownTooltip {...mockParams} />);

    const div = container.firstChild as HTMLElement;
    expect(div).toBeInTheDocument();
    expect(div.innerHTML).toContain('<strong>bold</strong>');
    expect(div.innerHTML).toContain('<em>italic</em>');
  });

  it('sanitizes malicious HTML in notes to prevent XSS', () => {
    const mockValue: TagCellValue = {
      rowId: 1,
      labels: [],
      note: 'Safe text <script>alert("XSS")</script> more text',
      updatedAt: Date.now()
    };

    const mockParams = createMockParams(mockValue);
    const { container } = render(<MarkdownTooltip {...mockParams} />);

    const div = container.firstChild as HTMLElement;
    expect(div).toBeInTheDocument();
    expect(div.innerHTML).toContain('Safe text');
    expect(div.innerHTML).toContain('more text');
    expect(div.innerHTML).not.toContain('<script>');
    expect(div.innerHTML).not.toContain('alert("XSS")');
  });

  it('renders label name when note is not present', () => {
    const mockValue: TagCellValue = {
      rowId: 1,
      labels: [{ id: 'label-1', name: 'Important Label' }],
      updatedAt: Date.now()
    };

    const mockParams = createMockParams(mockValue);
    const { container } = render(<MarkdownTooltip {...mockParams} />);

    const div = container.firstChild as HTMLElement;
    expect(div).toBeInTheDocument();
    expect(div.textContent).toBe('Important Label');
  });

  it('returns null when value is null', () => {
    const mockParams = createMockParams(null);
    const { container } = render(<MarkdownTooltip {...mockParams} />);

    expect(container.firstChild).toBeNull();
  });

  it('returns null when value has neither note nor labelName', () => {
    const mockValue: TagCellValue = {
      rowId: 1,
      labels: [],
      updatedAt: Date.now()
    };

    const mockParams = createMockParams(mockValue);
    const { container } = render(<MarkdownTooltip {...mockParams} />);

    expect(container.firstChild).toBeNull();
  });
});

describe('getNextRowIndex', () => {
  it('selects the first row when moving down without an active selection', () => {
    expect(
      getNextRowIndex({
        rowCount: 10,
        currentIndex: null,
        direction: 'down'
      })
    ).toBe(0);
  });

  it('selects the last row when moving up without an active selection', () => {
    expect(
      getNextRowIndex({
        rowCount: 4,
        currentIndex: null,
        direction: 'up'
      })
    ).toBe(3);
  });

  it('moves relative to the current selection and clamps to bounds', () => {
    expect(
      getNextRowIndex({
        rowCount: 5,
        currentIndex: 0,
        direction: 'up'
      })
    ).toBe(0);
    expect(
      getNextRowIndex({
        rowCount: 5,
        currentIndex: 4,
        direction: 'down'
      })
    ).toBe(4);
    expect(
      getNextRowIndex({
        rowCount: 5,
        currentIndex: 2,
        direction: 'down'
      })
    ).toBe(3);
  });

  it('returns null when the grid has no rows', () => {
    expect(
      getNextRowIndex({
        rowCount: 0,
        currentIndex: null,
        direction: 'down'
      })
    ).toBeNull();
  });
});

describe('toggleRowSelection', () => {
  const createGridApi = (
    rowNode: Partial<{
      setSelected: (value: boolean, clearSelection?: boolean, source?: string) => void;
      isSelected: () => boolean;
    }> | null
  ): GridApi =>
    ({
      getRowNode: vi.fn(() => rowNode)
    } as unknown as GridApi);

  it('deselects the row when it is already selected', () => {
    const setSelected = vi.fn();
    const isSelected = vi.fn(() => true);
    const gridApi = createGridApi({ setSelected, isSelected });

    const result = toggleRowSelection(gridApi, 42);

    expect(result).toBe(true);
    expect(setSelected).toHaveBeenCalledWith(false, false, 'api');
  });

  it('selects the row when it is currently unselected', () => {
    const setSelected = vi.fn();
    const isSelected = vi.fn(() => false);
    const gridApi = createGridApi({ setSelected, isSelected });

    const result = toggleRowSelection(gridApi, 7);

    expect(result).toBe(true);
    expect(setSelected).toHaveBeenCalledWith(true, false, 'api');
  });

  it('returns false when the row does not exist', () => {
    const gridApi = createGridApi(null);

    expect(toggleRowSelection(gridApi, 10)).toBe(false);
  });
});
