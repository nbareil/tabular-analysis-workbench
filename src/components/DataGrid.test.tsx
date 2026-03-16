import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import type { FilterState } from '@state/sessionStore';
import type { ColumnState, GridApi } from 'ag-grid-community';
import type { ICellRendererParams } from 'ag-grid-community';
import type { TagCellValue } from '@utils/tagCells';

import {
  MarkdownTooltip,
  computeAutoColumnWidth,
  computeMedianWidth,
  evaluateFilterMenuMetadata,
  formatClipboardCellValue,
  getHeaderContextMenuColumnId,
  buildSortStateFromColumnState,
  getNextRowIndex,
  getEmptyStateMessage,
  serializeRowForClipboard,
  serializeRowsForClipboard,
  shouldShowEmptyOverlay,
  shouldShowInitialPlaceholder,
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

describe('auto width helpers', () => {
  it('computes a true median for odd and even sample counts', () => {
    expect(computeMedianWidth([60, 20, 40])).toBe(40);
    expect(computeMedianWidth([20, 40, 60, 80])).toBe(50);
  });

  it('uses the larger of header width and median value width', () => {
    expect(
      computeAutoColumnWidth({
        valueSamples: [40, 44, 48, 52, 400],
        headerWidth: 96
      })
    ).toBe(96);
  });

  it('keeps narrow columns below the old 120px floor when measurements allow it', () => {
    expect(
      computeAutoColumnWidth({
        valueSamples: [30, 34, 38, 42, 46],
        headerWidth: 72
      })
    ).toBe(80);
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

describe('getEmptyStateMessage', () => {
  it('explains zero rows as an active view-state result when data is loaded', () => {
    expect(
      getEmptyStateMessage({
        status: 'ready',
        totalRows: 42,
        matchedRows: 0
      })
    ).toBe('No rows match the current filters or search.');
  });

  it('uses the file picker prompt before any dataset is loaded', () => {
    expect(
      getEmptyStateMessage({
        status: 'idle',
        totalRows: 0,
        matchedRows: 0
      })
    ).toBe('Select a CSV or TSV file to begin.');
  });
});

describe('empty state visibility helpers', () => {
  it('shows the initial placeholder only before any dataset is loaded', () => {
    expect(
      shouldShowInitialPlaceholder({
        status: 'idle',
        totalRows: 0,
        columnCount: 0
      })
    ).toBe(true);

    expect(
      shouldShowInitialPlaceholder({
        status: 'ready',
        totalRows: 42,
        columnCount: 3
      })
    ).toBe(false);
  });

  it('keeps the grid mounted and uses an overlay for zero matched rows', () => {
    expect(
      shouldShowEmptyOverlay({
        status: 'ready',
        totalRows: 42,
        matchedRows: 0,
        columnCount: 3
      })
    ).toBe(true);

    expect(
      shouldShowEmptyOverlay({
        status: 'ready',
        totalRows: 0,
        matchedRows: 0,
        columnCount: 0
      })
    ).toBe(false);
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

describe('clipboard row serialization', () => {
  it('formats tag values with labels and notes', () => {
    const value: TagCellValue = {
      rowId: 12,
      labels: [
        { id: 'l1', name: 'Suspicious' },
        { id: 'l2', name: 'Escalate' }
      ],
      note: 'needs\nreview',
      updatedAt: Date.now()
    };

    expect(formatClipboardCellValue(value)).toBe('Suspicious, Escalate | note: needs review');
  });

  it('serializes a displayed row as tab-delimited headers and values', () => {
    expect(
      serializeRowForClipboard([
        { headerName: 'Name', value: 'Alice' },
        { headerName: 'Status', value: 'open\tcase' },
        { headerName: 'Count', value: 3 },
        { headerName: 'Extra', value: null }
      ])
    ).toBe('Name\tStatus\tCount\tExtra\nAlice\topen case\t3\t');
  });

  it('stringifies object values when a cell exposes structured data', () => {
    expect(
      serializeRowForClipboard([{ headerName: 'Payload', value: { foo: 'bar', count: 2 } }])
    ).toBe('Payload\n{"foo":"bar","count":2}');
  });

  it('serializes multiple rows under a single header line', () => {
    expect(
      serializeRowsForClipboard([
        [
          { headerName: 'Name', value: 'Alice' },
          { headerName: 'Count', value: 3 }
        ],
        [
          { headerName: 'Name', value: 'Bob' },
          { headerName: 'Count', value: 7 }
        ]
      ])
    ).toBe('Name\tCount\nAlice\t3\nBob\t7');
  });
});

describe('getHeaderContextMenuColumnId', () => {
  it('returns the header col-id for header cell descendants', () => {
    const headerCell = document.createElement('div');
    headerCell.className = 'ag-header-cell';
    headerCell.setAttribute('col-id', 'status');
    const label = document.createElement('span');
    headerCell.appendChild(label);

    expect(getHeaderContextMenuColumnId(label)).toBe('status');
  });

  it('ignores non-header targets', () => {
    const cell = document.createElement('div');
    cell.className = 'ag-cell';
    cell.setAttribute('col-id', 'status');

    expect(getHeaderContextMenuColumnId(cell)).toBeNull();
  });
});
