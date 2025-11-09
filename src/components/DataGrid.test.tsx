import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import type { FilterState } from '@state/sessionStore';
import type { ColumnState } from 'ag-grid-community';
import type { ICellRendererParams } from 'ag-grid-community';
import type { TagCellValue } from '@utils/tagCells';

import { MarkdownTooltip, evaluateFilterMenuMetadata, buildSortStateFromColumnState } from './DataGrid';

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
      labelId: null,
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
      labelId: null,
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
      labelId: 'label-1',
      labelName: 'Important Label',
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
      labelId: null,
      updatedAt: Date.now()
    };

    const mockParams = createMockParams(mockValue);
    const { container } = render(<MarkdownTooltip {...mockParams} />);

    expect(container.firstChild).toBeNull();
  });
});
