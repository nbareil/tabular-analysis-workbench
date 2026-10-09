import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import type { FilterState } from '@state/sessionStore';
import type { ColumnState, GridApi } from 'ag-grid-community';
import type { ICellRendererParams } from 'ag-grid-community';
import type { TagCellValue } from '@utils/tagCells';

import { HighlightCell, MarkdownTooltip, TagCellRenderer } from './grid/GridCells';
import {
  computeAutoColumnWidth,
  computeMedianWidth,
  evaluateFilterMenuMetadata,
  formatClipboardCellValue,
  getHeaderContextMenuColumnId,
  isWithinGridContextMenu,
  buildSortStateFromColumnState,
  getNextRowIndex,
  getEmptyStateMessage,
  serializeRowForClipboard,
  serializeRowsForClipboard,
  shouldShowEmptyOverlay,
  shouldShowInitialPlaceholder,
  sortDistributionItems,
  sortsEqual,
  toggleRowSelection
} from './grid/gridUtils';

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

  it('orders by sortIndex regardless of column order', () => {
    const columnState: ColumnState[] = [
      { colId: 'second', sort: 'asc', sortIndex: 1 },
      { colId: 'first', sort: 'desc', sortIndex: 0 }
    ];

    expect(buildSortStateFromColumnState(columnState)).toEqual([
      { column: 'first', direction: 'desc' },
      { column: 'second', direction: 'asc' }
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
    api: null as any,
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

  it('returns null for non-tag tooltip values', () => {
    const mockParams = createMockParams('plain text' as unknown as TagCellValue);
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

describe('isWithinGridContextMenu', () => {
  it('returns true for descendants of the context menu overlay', () => {
    const menu = document.createElement('div');
    menu.setAttribute('data-grid-context-menu', 'true');
    const child = document.createElement('button');
    menu.appendChild(child);

    expect(isWithinGridContextMenu(child)).toBe(true);
  });

  it('returns false for targets outside the context menu overlay', () => {
    const outside = document.createElement('div');

    expect(isWithinGridContextMenu(outside)).toBe(false);
    expect(isWithinGridContextMenu(null)).toBe(false);
  });
});

describe('sortsEqual', () => {
  it('compares column and direction in order', () => {
    expect(sortsEqual([], [])).toBe(true);
    expect(sortsEqual([{ column: 'a', direction: 'asc' }], [{ column: 'a', direction: 'asc' }])).toBe(true);
    expect(sortsEqual([{ column: 'a', direction: 'asc' }], [{ column: 'a', direction: 'desc' }])).toBe(false);
    expect(
      sortsEqual(
        [
          { column: 'a', direction: 'asc' },
          { column: 'b', direction: 'asc' }
        ],
        [
          { column: 'b', direction: 'asc' },
          { column: 'a', direction: 'asc' }
        ]
      )
    ).toBe(false);
    expect(sortsEqual([{ column: 'a', direction: 'asc' }], [])).toBe(false);
  });
});

describe('sortDistributionItems', () => {
  const items = [
    { value: 'b', count: 2 },
    { value: 'a', count: 2 },
    { value: 'c', count: 5 }
  ];

  it('sorts by count in the requested direction and breaks ties by value', () => {
    expect(sortDistributionItems(items, 'desc').map((item) => item.value)).toEqual(['c', 'a', 'b']);
    expect(sortDistributionItems(items, 'asc').map((item) => item.value)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    sortDistributionItems(items, 'asc');
    expect(items.map((item) => item.value)).toEqual(['b', 'a', 'c']);
  });
});

describe('TagCellRenderer', () => {
  const renderTag = (value: TagCellValue | null) =>
    render(<TagCellRenderer {...({ value } as ICellRendererParams<TagCellValue | null>)} />);

  it('prompts to add a label for untagged rows', () => {
    expect(renderTag(null).container.textContent).toBe('Add label');
  });

  it('shows the first label, the extra count and a note marker', () => {
    const { container } = renderTag({
      rowId: 1,
      labels: [
        { id: 'a', name: 'Alpha', color: '#f00' },
        { id: 'b', name: 'Beta' },
        { id: 'c', name: 'Gamma' }
      ],
      note: 'hi',
      updatedAt: 1
    });
    expect(container.textContent).toBe('Alpha+2 moreNote');
  });

  it('labels note-only rows', () => {
    expect(renderTag({ rowId: 1, labels: [], note: 'hi', updatedAt: 1 }).container.textContent).toBe('No labelNote');
  });
});

describe('HighlightCell', () => {
  const renderCell = (props: { value?: unknown; valueFormatted?: string | null; query: string; caseSensitive?: boolean }) =>
    render(
      <HighlightCell
        {...({ value: props.value, valueFormatted: props.valueFormatted ?? null } as ICellRendererParams)}
        query={props.query}
        caseSensitive={props.caseSensitive ?? false}
      />
    );

  const marks = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll('mark')).map((mark) => mark.textContent ?? '');

  it('renders plain text without marks when the query is blank', () => {
    const { container } = renderCell({ value: 'hello world', query: '   ' });
    expect(container.textContent).toBe('hello world');
    expect(marks(container)).toEqual([]);
  });

  it('highlights every occurrence case-insensitively, preserving original casing', () => {
    const { container } = renderCell({ value: 'Error: error ERROR', query: 'error' });
    expect(marks(container)).toEqual(['Error', 'error', 'ERROR']);
    expect(container.textContent).toBe('Error: error ERROR');
  });

  it('respects case sensitivity', () => {
    const { container } = renderCell({ value: 'Error error', query: 'error', caseSensitive: true });
    expect(marks(container)).toEqual(['error']);
  });

  it('trims the query and does not overlap matches', () => {
    const { container } = renderCell({ value: 'aaaa', query: ' aa ' });
    expect(marks(container)).toEqual(['aa', 'aa']);
  });

  it('prefers the formatted value and handles null values', () => {
    expect(marks(renderCell({ value: 1700000000000, valueFormatted: '2023-11-14', query: '11' }).container)).toEqual([
      '11'
    ]);
    expect(renderCell({ value: null, query: 'x' }).container.textContent).toBe('');
    expect(marks(renderCell({ value: 12345, query: '23' }).container)).toEqual(['23']);
  });

  it('treats the query literally rather than as a pattern', () => {
    const { container } = renderCell({ value: 'a.b axb', query: 'a.b' });
    expect(marks(container)).toEqual(['a.b']);
  });

it('highlights the right characters after a length-changing lowercase character', () => {
    const { container } = renderCell({ value: 'İstanbul', query: 'stan' });
    expect(marks(container)).toEqual(['stan']);
  });
});
