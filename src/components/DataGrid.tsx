import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AgGridReact } from 'ag-grid-react';
import type {
  CellContextMenuEvent,
  ColumnState,
  SortChangedEvent,
  IDatasource,
  IGetRowsParams,
  GridApi,
  ColumnApi,
  GridReadyEvent,
  SelectionChangedEvent,
  ColDef,
  ICellRendererParams
} from 'ag-grid-community';

import { useAppStore } from '@state/appStore';
import { useDataStore, type GridColumn, type GridRow, type LoaderStatus } from '@state/dataStore';
import { useTagStore } from '@state/tagStore';
import type { FilterState, SessionSnapshot } from '@state/sessionStore';
import { useSessionStore } from '@state/sessionStore';
import { getDataWorker } from '@workers/dataWorkerProxy';
import { logDebug } from '@utils/debugLog';
import { buildTagCellValue, type TagCellValue } from '@utils/tagCells';
import { renderMarkdownToSafeHtml } from '@utils/markdown';
import { useFilterSync } from '@/hooks/useFilterSync';
import { useSortSync } from '@/hooks/useSortSync';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from '@workers/types';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

export interface FilterMenuMetadata {
  eqIndex: number;
  eqMatchesValue: boolean;
  neqExists: boolean;
}

export const evaluateFilterMenuMetadata = (
  filters: FilterState[],
  columnId: string,
  valueAsString: string
): FilterMenuMetadata => {
  const eqIndex = filters.findIndex(
    (filter) => filter.enabled !== false && filter.column === columnId && filter.operator === 'eq'
  );

  const eqMatchesValue =
    eqIndex >= 0 &&
    String(filters[eqIndex]!.value ?? '') === valueAsString &&
    !filters[eqIndex]!.fuzzy;

  const neqExists = filters.some(
    (filter) =>
      filter.enabled !== false &&
      filter.column === columnId &&
      filter.operator === 'neq' &&
      String(filter.value ?? '') === valueAsString
  );

  return {
    eqIndex,
    eqMatchesValue,
    neqExists
  };
};

type SortState = SessionSnapshot['sorts'][number];

const sortsEqual = (left: SortState[], right: SortState[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (sort, index) =>
      sort.column === right[index]?.column && sort.direction === right[index]?.direction
  );
};

export const buildSortStateFromColumnState = (columnState: ColumnState[]): SortState[] =>
  columnState
    .filter((state) => state.sort != null)
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map((state) => ({
      column: state.colId ?? '',
      direction: state.sort === 'desc' ? ('desc' as const) : ('asc' as const)
    }))
    .filter((sort) => Boolean(sort.column));

interface FilterContextMenuState {
  x: number;
  y: number;
  columnId: string;
  displayValue: string;
  filterValue: string | null;
  rowId: number | null;
}

const AUTO_WIDTH_PERCENTILE = 0.8;
const AUTO_WIDTH_MAX_SAMPLE_ROWS = 1_000;
const AUTO_WIDTH_BLOCK_SIZE = 250;
const CELL_HORIZONTAL_PADDING_PX = 32;
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 520;

export const getNextRowIndex = ({
  rowCount,
  currentIndex,
  direction
}: {
  rowCount: number;
  currentIndex: number | null;
  direction: 'up' | 'down';
}): number | null => {
  if (rowCount <= 0) {
    return null;
  }

  if (currentIndex == null || Number.isNaN(currentIndex)) {
    return direction === 'down' ? 0 : rowCount - 1;
  }

  const delta = direction === 'down' ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(rowCount - 1, currentIndex + delta));
  return nextIndex;
};

const TagCellRenderer = ({
value
}: ICellRendererParams<TagCellValue | null>): JSX.Element => {
if (!value) {
return (
<span className="flex items-center gap-2 text-[11px] text-slate-500">
<span className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-600" aria-hidden />
Add label
</span>
);
}

const { color, labelName, note } = value;
const text = labelName ?? (note ? 'No label' : 'Tagged');

return (
<span className="flex items-center gap-2 truncate text-xs text-slate-100">
<span
className="h-2.5 w-2.5 shrink-0 rounded-full"
style={
color
? { backgroundColor: color }
: { border: '1px solid rgb(71 85 105)', backgroundColor: 'transparent' }
}
aria-hidden
/>
<span className="truncate">{text}</span>
{note ? (
<span className="text-[10px] uppercase tracking-wide text-slate-400">Note</span>
) : null}
</span>
);
};

export const MarkdownTooltip = ({
  value
}: ICellRendererParams<TagCellValue | null>): JSX.Element | null => {
  if (!value) {
    return null;
  }

  const { labelName, note } = value;

  if (note) {
    const html = renderMarkdownToSafeHtml(note);
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  if (labelName) {
    return <div>{labelName}</div>;
  }

  return null;
};

interface DataGridProps {
  status: LoaderStatus;
  onEditTagNote?: (payload: { rowId: number }) => void;
}

const DataGrid = ({ status, onEditTagNote }: DataGridProps): JSX.Element => {
  const columns = useDataStore((state) => state.columns);
  const searchRows = useDataStore((state) => state.searchRows);
  const matchedRows = useDataStore((state) => state.matchedRows);
  const viewVersion = useDataStore((state) => state.viewVersion);
  const totalRows = useDataStore((state) => state.totalRows);
  const theme = useAppStore((state) => state.theme);
  const { filters, applyFilters } = useFilterSync();
  const { sorts, applySorts } = useSortSync();
  const [contextMenu, setContextMenu] = useState<FilterContextMenuState | null>(null);
  const columnLayout = useSessionStore((state) => state.columnLayout);
  const setColumnLayout = useSessionStore((state) => state.setColumnLayout);
  const [gridApi, setGridApi] = useState<GridApi | null>(null);
  const [columnApi, setColumnApi] = useState<ColumnApi | null>(null);
  const [autoColumnWidths, setAutoColumnWidths] = useState<Record<string, number>>({});
  const tagLabels = useTagStore((state) => state.labels);
  const tagRecords = useTagStore((state) => state.tags);
  const tagStatus = useTagStore((state) => state.status);
  const tagError = useTagStore((state) => state.error);
  const loadTags = useTagStore((state) => state.load);
  const applyTagToRows = useTagStore((state) => state.applyTag);
  const clearTagFromRows = useTagStore((state) => state.clearTag);
  const initialRowsRequestedRef = useRef(false);
  const loadingVersionRef = useRef<number | null>(null);
  const computedVersionRef = useRef<number | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const [tagMutationPending, setTagMutationPending] = useState(false);
  const [keyboardFocusedRowId, setKeyboardFocusedRowId] = useState<number | null>(null);

  useEffect(() => {
    if (!columns.length) {
      return;
    }

    const existingOrder = columnLayout.order.length
      ? [...columnLayout.order]
      : [];
    const seen = new Set(existingOrder);
    let changed = false;

    for (const column of columns) {
      if (!seen.has(column.key)) {
        existingOrder.push(column.key);
        seen.add(column.key);
        changed = true;
      }
    }

    const nextVisibility: Record<string, boolean> = { ...columnLayout.visibility };
    for (const column of columns) {
      if (!(column.key in nextVisibility)) {
        nextVisibility[column.key] = true;
        changed = true;
      }
    }

    if (changed) {
      setColumnLayout({
        order: existingOrder,
        visibility: nextVisibility
      });
    }
  }, [columnLayout.order, columnLayout.visibility, columns, setColumnLayout]);

  const orderedColumns = useMemo(() => {
    const baseOrder = columnLayout.order.length
      ? columnLayout.order
      : columns.map((column) => column.key);
    const additions = columns
      .map((column) => column.key)
      .filter((key) => !baseOrder.includes(key));
    const finalOrder = [...baseOrder, ...additions];

    return finalOrder
      .map((key) => columns.find((column) => column.key === key))
      .filter((column): column is (typeof columns)[number] => Boolean(column));
  }, [columnLayout.order, columns]);

  useEffect(() => {
    if (!columnApi) {
      return;
    }

    columnApi.applyColumnState({
      state: orderedColumns.map((column, index) => ({
        colId: column.key,
        hide: columnLayout.visibility[column.key] === false,
        order: index,
        ...(autoColumnWidths[column.key] != null
          ? { width: Math.round(autoColumnWidths[column.key]!) }
          : {})
      })),
      applyOrder: true
    });
  }, [autoColumnWidths, columnApi, orderedColumns, columnLayout.visibility]);

  const mapColumnTypeToAgDataType = useMemo(() => {
    const mapping: Record<GridColumn['type'], 'text' | 'number' | 'boolean' | 'dateString'> = {
      string: 'text',
      number: 'number',
      boolean: 'boolean',
      datetime: 'text'
    };
    return (type: GridColumn['type']) => mapping[type] ?? 'text';
  }, []);

  const labelLookup = useMemo(() => {
    const map = new Map<string, (typeof tagLabels)[number]>();
    for (const label of tagLabels) {
      map.set(label.id, label);
    }
    return map;
  }, [tagLabels]);

  const tagDataRef = useRef({
    tags: tagRecords,
    labels: labelLookup
  });

  useEffect(() => {
    tagDataRef.current = {
      tags: tagRecords,
      labels: labelLookup
    };
  }, [labelLookup, tagRecords]);

  useEffect(() => {
    if (status === 'ready' && tagStatus === 'idle') {
      void loadTags();
    }
  }, [loadTags, status, tagStatus]);

  useEffect(() => {
    if (!gridApi) {
      return;
    }

    gridApi.refreshCells({
      columns: [TAG_COLUMN_ID],
      force: true,
      suppressFlash: true
    });
  }, [gridApi, tagLabels, tagRecords]);

  const tagColumnDef = useMemo<ColDef>(
    () => ({
      colId: TAG_COLUMN_ID,
      headerName: 'Label',
      headerTooltip: 'Row label',
      pinned: 'left',
      lockPosition: true,
      headerCheckboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      checkboxSelection: true,
      suppressMenu: true,
      sortable: false,
      resizable: false,
      suppressSizeToFit: true,
      width: 160,
      minWidth: 140,
      maxWidth: 220,
      cellRenderer: TagCellRenderer,
      valueGetter: (params) => {
        const { tags, labels } = tagDataRef.current;
        return buildTagCellValue(params.data?.__rowId, tags, labels);
      },
      tooltipComponent: MarkdownTooltip
    }),
    []
  );

  const dataColumnDefs = useMemo(
    () =>
      orderedColumns.map((column) => ({
        field: column.key,
        headerName: column.headerName,
        cellDataType: mapColumnTypeToAgDataType(column.type),
        sortable: true,
        filter: true,
        tooltipField: column.key,
        headerTooltip:
          column.confidence > 0
            ? `${column.type} • ${column.confidence}% confidence`
            : column.type,
        hide: columnLayout.visibility[column.key] === false,
        ...((): { sort?: 'asc' | 'desc'; sortIndex?: number } => {
          const sortPosition = sorts.findIndex((sort) => sort.column === column.key);
          if (sortPosition < 0) {
            return {};
          }

          return {
            sort: sorts[sortPosition]?.direction,
            sortIndex: sortPosition
          };
        })()
      })),
    [columnLayout.visibility, mapColumnTypeToAgDataType, orderedColumns, sorts]
  );

  const columnDefs = useMemo(
    () => [tagColumnDef, ...dataColumnDefs],
    [dataColumnDefs, tagColumnDef]
  );

  const defaultColDef = useMemo(
    () => ({
      flex: 1,
      minWidth: 140,
      resizable: true
    }),
    []
  );

  useEffect(() => {
    if (!gridApi) {
      return;
    }

    const datasource: IDatasource = {
      getRows: async (params: IGetRowsParams) => {
        try {
          if (import.meta.env.DEV) {
            logDebug('grid', 'getRows request', {
              startRow: params.startRow,
              endRow: params.endRow,
              usingSearchRows: Boolean(searchRows)
            });
          }

          if (searchRows) {
            const slice = searchRows.slice(params.startRow, params.endRow);
            params.successCallback(slice, searchRows.length);
            if (import.meta.env.DEV) {
              logDebug('grid', 'Served search rows', {
                served: slice.length,
                totalMatches: searchRows.length
              });
            }
            return;
          }

          const worker = getDataWorker();
          const requestSize = params.endRow - params.startRow;
          const response = await worker.fetchRows({
            offset: params.startRow,
            limit: requestSize
          });
          params.successCallback(response.rows as GridRow[], response.matchedRows);
          if (import.meta.env.DEV) {
            logDebug('grid', 'Worker fetchRows response', {
              offset: params.startRow,
              limit: requestSize,
              rowsReceived: response.rows.length,
              matchedRows: response.matchedRows,
              totalRows: response.totalRows
            });
          }
        } catch (error) {
          console.error('Failed to fetch rows for grid', error);
          params.failCallback();
        }
      }
    };

    if (typeof gridApi.setGridOption === 'function') {
      gridApi.setGridOption('datasource', datasource);
    } else if (typeof gridApi.setDatasource === 'function') {
      gridApi.setDatasource(datasource);
    }
  }, [gridApi, searchRows, viewVersion]);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }

    if (gridApi && typeof gridApi.refreshInfiniteCache === 'function') {
      if (import.meta.env.DEV) {
        logDebug('grid', 'refreshing infinite cache after ready status');
      }
      gridApi.refreshInfiniteCache();
    }
  }, [gridApi, status]);

  useEffect(() => {
    if (status === 'loading') {
      loadingVersionRef.current = viewVersion;
      computedVersionRef.current = null;
      setAutoColumnWidths({});
      initialRowsRequestedRef.current = false;
      setKeyboardFocusedRowId(null);
    }
  }, [status, viewVersion]);

  useEffect(() => {
    if (
      status !== 'loading' ||
      initialRowsRequestedRef.current ||
      !gridApi ||
      typeof gridApi.refreshInfiniteCache !== 'function' ||
      totalRows <= 0
    ) {
      return;
    }

    initialRowsRequestedRef.current = true;
    gridApi.refreshInfiniteCache();
  }, [gridApi, status, totalRows]);

  useEffect(() => {
    if (status !== 'ready' || !gridApi || !columns.length || totalRows <= 0) {
      return;
    }

    const targetVersion = loadingVersionRef.current ?? viewVersion;
    if (computedVersionRef.current === targetVersion) {
      return;
    }

    let cancelled = false;

    const computeAutoWidths = async () => {
      try {
        const worker = getDataWorker();
        const effectiveTotalRows = Math.max(0, totalRows);
        const maxSamples = Math.min(AUTO_WIDTH_MAX_SAMPLE_ROWS, effectiveTotalRows);
        const blockSize = Math.min(AUTO_WIDTH_BLOCK_SIZE, maxSamples || AUTO_WIDTH_BLOCK_SIZE);
        const blockCount = Math.max(1, Math.ceil((maxSamples || 1) / Math.max(1, blockSize)));
        const offsets: number[] = [];

        if (blockCount === 1) {
          offsets.push(0);
        } else {
          const maxOffset = Math.max(0, effectiveTotalRows - blockSize);
          const step = blockCount > 1 ? Math.max(1, Math.floor(maxOffset / (blockCount - 1))) : 0;
          for (let index = 0; index < blockCount; index += 1) {
            const offset = Math.min(maxOffset, index * step);
            offsets.push(offset);
          }
        }

        const sampledRows: GridRow[] = [];
        for (const offset of offsets) {
          if (cancelled) {
            return;
          }
          const limit = Math.min(blockSize, effectiveTotalRows - offset);
          if (limit <= 0) {
            continue;
          }
          const response = await worker.fetchRows({ offset, limit });
          if (cancelled) {
            return;
          }
          sampledRows.push(...((response.rows as GridRow[]) ?? []));
          if (sampledRows.length >= AUTO_WIDTH_MAX_SAMPLE_ROWS) {
            break;
          }
        }

        if (cancelled) {
          return;
        }

        if (!sampledRows.length) {
          const response = await worker.fetchRows({
            offset: 0,
            limit: Math.min(blockSize, effectiveTotalRows)
          });
          sampledRows.push(...((response.rows as GridRow[]) ?? []));
        }

        if (!sampledRows.length) {
          computedVersionRef.current = targetVersion;
          return;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
          computedVersionRef.current = targetVersion;
          return;
        }

        const rootStyle = window.getComputedStyle(document.documentElement);
        const fontFamilyValue = rootStyle.getPropertyValue('--data-font-family').trim();
        const fontSizeValue = rootStyle.getPropertyValue('--data-font-size').trim();
        const fallbackFontFamily = fontFamilyValue || 'Inter, sans-serif';
        const parsedFontSize = parseFloat(fontSizeValue || '');
        const fontSize = Number.isFinite(parsedFontSize) && parsedFontSize > 0 ? parsedFontSize : 13;
        context.font = `${fontSize}px ${fallbackFontFamily}`;

        const measureCache = new Map<string, number>();
        const columnWidthSamples: Record<string, number[]> = {};

        const measureText = (text: string): number => {
          const cached = measureCache.get(text);
          if (cached != null) {
            return cached;
          }
          const width = context.measureText(text).width + CELL_HORIZONTAL_PADDING_PX;
          measureCache.set(text, width);
          return width;
        };

        for (const column of columns) {
          columnWidthSamples[column.key] = [];
        }

        for (const row of sampledRows) {
          for (const column of columns) {
            const rawValue = row[column.key];
            const text = rawValue == null ? '' : String(rawValue);
            columnWidthSamples[column.key]!.push(measureText(text));
          }
        }

        for (const column of columns) {
          const headerText = column.headerName || column.key;
          columnWidthSamples[column.key]!.push(measureText(headerText));
        }

        const nextWidths: Record<string, number> = {};

        for (const column of columns) {
          const samples = columnWidthSamples[column.key] ?? [];
          if (!samples.length) {
            nextWidths[column.key] = MIN_COLUMN_WIDTH;
            continue;
          }

          samples.sort((a, b) => a - b);
          const percentileIndex = Math.max(
            0,
            Math.floor((samples.length - 1) * AUTO_WIDTH_PERCENTILE)
          );
          const percentileWidth = samples[percentileIndex] ?? MIN_COLUMN_WIDTH;
          const boundedWidth = Math.min(
            MAX_COLUMN_WIDTH,
            Math.max(MIN_COLUMN_WIDTH, Math.ceil(percentileWidth))
          );
          nextWidths[column.key] = boundedWidth;
        }

        if (cancelled) {
          return;
        }

        setAutoColumnWidths(nextWidths);
        computedVersionRef.current = targetVersion;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[grid] Failed to compute auto column widths', error);
        }
      }
    };

    void computeAutoWidths();

    return () => {
      cancelled = true;
    };
  }, [columns, gridApi, status, totalRows, viewVersion]);

  const themeClass = theme === 'dark' ? 'ag-theme-quartz-dark' : 'ag-theme-quartz';
  const showPlaceholder = status !== 'loading' && (matchedRows ?? 0) === 0;
  const menuMetadata = useMemo(() => {
    if (!contextMenu) {
      return null;
    }

    const value = contextMenu.filterValue ?? '';
    return evaluateFilterMenuMetadata(filters, contextMenu.columnId, String(value));
  }, [contextMenu, filters]);

  const closeMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handleGlobalMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) {
        closeMenu();
        return;
      }

      if (event.target.closest('[data-grid-context-menu="true"]')) {
        return;
      }

      closeMenu();
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    const handleScroll = () => {
      closeMenu();
    };

    window.addEventListener('mousedown', handleGlobalMouseDown);
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('mousedown', handleGlobalMouseDown);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeMenu, contextMenu]);

  useEffect(() => {
    if (!contextMenu && tagMutationPending) {
      setTagMutationPending(false);
    }
  }, [contextMenu, tagMutationPending]);

  useEffect(() => {
    const container = gridContainerRef.current;
    if (!gridApi || !container) {
      return;
    }

    const resolveFocusColumnId = (): string | null => {
      if (columnApi && typeof columnApi.getAllDisplayedColumns === 'function') {
        const displayedColumns = columnApi.getAllDisplayedColumns();
        if (displayedColumns.length > 0) {
          const firstColumn = displayedColumns[0];
          const colId =
            firstColumn && typeof firstColumn.getColId === 'function'
              ? firstColumn.getColId()
              : null;
          if (colId) {
            return colId;
          }
        }
      }

      const fallback = columnDefs[0];
      if (fallback?.field) {
        return fallback.field;
      }
      return TAG_COLUMN_ID;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const targetElement = event.target as HTMLElement | null;
      if (targetElement?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }

      const rowCount = gridApi.getDisplayedRowCount();
      if (rowCount <= 0) {
        return;
      }

      const selectedNodes = gridApi.getSelectedNodes();
      const anchorNode = selectedNodes[selectedNodes.length - 1];
      const direction = event.key === 'ArrowDown' ? 'down' : 'up';
      const targetIndex = getNextRowIndex({
        rowCount,
        currentIndex: anchorNode?.rowIndex ?? null,
        direction
      });

      if (targetIndex == null) {
        return;
      }

      event.preventDefault();

      const focusColumnId = resolveFocusColumnId();

      const selectIndex = (index: number): boolean => {
        const node = gridApi.getDisplayedRowAtIndex(index);
        if (!node) {
          return false;
        }

        gridApi.deselectAll();
        node.setSelected(true, undefined, 'api');
        gridApi.ensureIndexVisible(index, 'middle');
        if (focusColumnId && typeof gridApi.setFocusedCell === 'function') {
          gridApi.setFocusedCell(index, focusColumnId);
        }
        const nodeRowId =
          typeof node.data?.__rowId === 'number' && Number.isFinite(node.data.__rowId)
            ? node.data.__rowId
            : null;
        setKeyboardFocusedRowId(nodeRowId);
        return true;
      };

      if (selectIndex(targetIndex)) {
        return;
      }

      gridApi.ensureIndexVisible(targetIndex, 'middle');
      requestAnimationFrame(() => {
        selectIndex(targetIndex);
      });
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [columnApi, columnDefs, gridApi]);

  useEffect(() => {
    if (!gridApi) {
      return;
    }

    if (typeof gridApi.redrawRows === 'function') {
      gridApi.redrawRows();
    } else {
      gridApi.refreshCells?.({ force: true });
    }
  }, [gridApi, keyboardFocusedRowId]);

  const handleCellContextMenu = useCallback(
    (params: CellContextMenuEvent<GridRow>) => {
      const mouseEvent = params.event as MouseEvent;
      mouseEvent.preventDefault();

      const columnId = params.column?.getColId();
      if (!columnId) {
        return;
      }

      const isTagColumn = columnId === TAG_COLUMN_ID;
      if (isTagColumn && tagStatus === 'idle') {
        void loadTags();
      }

      if (gridApi && params.node && typeof params.node.setSelected === 'function') {
        const alreadySelected = params.node.isSelected?.() ?? false;
        if (!alreadySelected) {
          gridApi.deselectAll();
          params.node.setSelected(true, undefined, 'api');
        }
      }

      const rawValue = params.value as TagCellValue | unknown;
      if (!isTagColumn && rawValue == null) {
        return;
      }

      let displayValue: string;
      let filterValue: string | null;

      if (isTagColumn) {
        const tagValue = (rawValue as TagCellValue | null) ?? null;
        const name = tagValue?.labelName;
        displayValue = name && name.trim().length > 0 ? name : 'No label';
        filterValue = tagValue?.labelId ?? TAG_NO_LABEL_FILTER_VALUE;
      } else {
        const valueString = typeof rawValue === 'string' ? rawValue : String(rawValue);
        displayValue = valueString;
        filterValue = valueString;
      }

      const rowId = Number.isFinite(params.data?.__rowId) ? Number(params.data?.__rowId) : null;

      const menuWidth = 220;
      const estimatedHeight = isTagColumn
        ? 140 + Math.min(tagLabels.length || 1, 6) * 28
        : 96;
      let x = mouseEvent.clientX;
      let y = mouseEvent.clientY;

      if (x + menuWidth > window.innerWidth) {
        x = Math.max(0, window.innerWidth - menuWidth - 8);
      }

      if (y + estimatedHeight > window.innerHeight) {
        y = Math.max(0, window.innerHeight - estimatedHeight - 8);
      }

      setContextMenu({
        x,
        y,
        columnId,
        displayValue,
        filterValue,
        rowId
      });
    },
    [gridApi, loadTags, tagLabels.length, tagStatus]
  );

  const getSelectedRowIds = useCallback((): number[] => {
    if (!gridApi || typeof gridApi.getSelectedNodes !== 'function') {
      return [];
    }

    const ids = gridApi
      .getSelectedNodes()
      .map((node) => node.data?.__rowId)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    return Array.from(new Set(ids));
  }, [gridApi]);

  const handleFilterIn = useCallback(() => {
    if (!contextMenu || !menuMetadata) {
      return;
    }

    if (menuMetadata.eqMatchesValue) {
      closeMenu();
      return;
    }

    const columnId = contextMenu.columnId;
    const isTagColumn = columnId === TAG_COLUMN_ID;
    const baseValue = contextMenu.filterValue ?? '';
    const predicateValue = isTagColumn
      ? baseValue || TAG_NO_LABEL_FILTER_VALUE
      : baseValue;

    if (menuMetadata.eqIndex >= 0) {
      const nextFilters = filters.slice();
      nextFilters[menuMetadata.eqIndex] = {
        ...nextFilters[menuMetadata.eqIndex]!,
        operator: 'eq',
        value: predicateValue,
        value2: undefined,
        fuzzy: isTagColumn ? false : nextFilters[menuMetadata.eqIndex]!.fuzzy,
        fuzzyExplicit: isTagColumn
          ? true
          : nextFilters[menuMetadata.eqIndex]!.fuzzyExplicit ?? false,
        caseSensitive: isTagColumn ? false : nextFilters[menuMetadata.eqIndex]!.caseSensitive,
        enabled: true
      };
      void applyFilters(nextFilters);
    } else {
      const predicate: FilterState = {
        id: crypto.randomUUID(),
        column: columnId,
        operator: 'eq',
        value: predicateValue,
        caseSensitive: false,
        enabled: true,
        ...(isTagColumn
          ? { fuzzy: false, fuzzyExplicit: true }
          : { fuzzy: false, fuzzyExplicit: false })
      };
      void applyFilters([...filters, predicate]);
    }

    closeMenu();
  }, [applyFilters, closeMenu, contextMenu, filters, menuMetadata]);

  const handleFilterOut = useCallback(() => {
    if (!contextMenu || !menuMetadata) {
      return;
    }

    if (menuMetadata.neqExists) {
      closeMenu();
      return;
    }

    const columnId = contextMenu.columnId;
    const isTagColumn = columnId === TAG_COLUMN_ID;
    const baseValue = contextMenu.filterValue ?? '';
    const predicateValue = isTagColumn
      ? baseValue || TAG_NO_LABEL_FILTER_VALUE
      : baseValue;

    const predicate: FilterState = {
      id: crypto.randomUUID(),
      column: columnId,
      operator: 'neq',
      value: predicateValue,
      caseSensitive: false,
      enabled: true,
      ...(isTagColumn
        ? { fuzzy: false, fuzzyExplicit: true }
        : { fuzzy: false, fuzzyExplicit: false })
    };
    void applyFilters([...filters, predicate]);
    closeMenu();
  }, [applyFilters, closeMenu, contextMenu, filters, menuMetadata]);

  const handleApplyLabel = useCallback(
    async (labelId: string | null) => {
      if (!contextMenu || contextMenu.rowId == null || tagMutationPending) {
        return;
      }

      const selected = getSelectedRowIds();
      const combined = selected.includes(contextMenu.rowId)
        ? selected
        : [...selected, contextMenu.rowId];
      const rowIds = Array.from(new Set(combined)).filter(
        (rowId): rowId is number => typeof rowId === 'number' && Number.isFinite(rowId) && rowId >= 0
      );

      if (!rowIds.length) {
        return;
      }

      try {
        setTagMutationPending(true);
        if (labelId === null) {
          await clearTagFromRows(rowIds);
        } else {
          await applyTagToRows({ rowIds, labelId });
        }
      } catch (error) {
        console.error('Failed to update labels', error);
      } finally {
        setTagMutationPending(false);
        closeMenu();
      }
    },
    [applyTagToRows, clearTagFromRows, closeMenu, contextMenu, getSelectedRowIds, tagMutationPending]
  );

  const handleEditNote = useCallback(() => {
    if (!contextMenu || contextMenu.rowId == null || !onEditTagNote) {
      return;
    }

    onEditTagNote({ rowId: contextMenu.rowId });
    closeMenu();
  }, [closeMenu, contextMenu, onEditTagNote]);

  const handleSortChanged = useCallback(
    (event: SortChangedEvent) => {
      const columnState = event.columnApi.getColumnState();
      const nextSorts = buildSortStateFromColumnState(columnState);

      if (!sortsEqual(nextSorts, sorts)) {
        // Use progressive sorting for large datasets (>50k rows)
        const useProgressive = totalRows > 50_000;
        const visibleRows = 2000; // Sort first 2000 rows immediately

        void applySorts(nextSorts, { progressive: useProgressive, visibleRows });
      }
    },
    [applySorts, sorts, totalRows]
  );

  const handleToggleColumn = useCallback(
    (columnId: string) => {
      const visible = columnLayout.visibility[columnId] !== false;
      const nextVisibility = {
        ...columnLayout.visibility,
        [columnId]: !visible
      };
      setColumnLayout({
        order: columnLayout.order,
        visibility: nextVisibility
      });

      if (gridApi) {
        gridApi.setColumnVisible(columnId, !visible);
      }
    },
    [columnLayout, gridApi, setColumnLayout]
  );

  const renderContextMenu = () => {
    if (!contextMenu || !menuMetadata) {
      return null;
    }

    const isLabelColumn = contextMenu.columnId === TAG_COLUMN_ID;
    const activeRecord =
      isLabelColumn && contextMenu.rowId != null ? tagRecords[contextMenu.rowId] : undefined;
    const activeLabelId = activeRecord?.labelId ?? null;
    const hasTagOrNote =
      Boolean(activeRecord?.labelId) || Boolean(activeRecord?.note);
    const isTagLoading = isLabelColumn && (tagStatus === 'loading' || tagStatus === 'idle');
    const selectedRowIds = getSelectedRowIds();
    const selectionIncludesContext =
      contextMenu.rowId != null && selectedRowIds.includes(contextMenu.rowId);
    const bulkApplyCount =
      contextMenu.rowId == null
        ? selectedRowIds.length
        : selectionIncludesContext
          ? selectedRowIds.length
          : selectedRowIds.length + 1;

    const columnVisible = columnLayout.visibility[contextMenu.columnId] !== false;

    const menu = (
    <div
    data-grid-context-menu="true"
    className="fixed z-[10000] min-w-[14rem] rounded border border-slate-700 bg-slate-900 p-1 text-xs text-slate-200 shadow-xl"
    style={{ top: contextMenu.y, left: contextMenu.x }}
    onMouseDown={(event) => event.stopPropagation()}
    >
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">Filters</div>
        <button
          type="button"
          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-800 ${
            menuMetadata.eqMatchesValue ? 'cursor-not-allowed opacity-50' : ''
          }`}
          onClick={handleFilterIn}
          disabled={menuMetadata.eqMatchesValue}
        >
          Filter in
          <span className="truncate text-slate-400">{contextMenu.displayValue}</span>
        </button>
        <button
          type="button"
          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-800 ${
            menuMetadata.neqExists ? 'cursor-not-allowed opacity-50' : ''
          }`}
          onClick={handleFilterOut}
          disabled={menuMetadata.neqExists}
        >
          Filter out
          <span className="truncate text-slate-400">{contextMenu.displayValue}</span>
        </button>
        {isLabelColumn ? (
          <div className="mt-1 border-t border-slate-800 pt-1">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">
              Labels
            </div>
            {bulkApplyCount > 1 ? (
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-emerald-500">
                Applies to {bulkApplyCount} rows
              </div>
            ) : null}
            {isTagLoading ? (
              <div className="px-2 py-1 text-[11px] text-slate-400">Loading labels…</div>
            ) : null}
            {tagError && tagStatus === 'error' ? (
              <div className="px-2 py-1 text-[11px] text-red-400">{tagError}</div>
            ) : null}
            {!isTagLoading && tagStatus === 'ready' && tagLabels.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-slate-400">
                No labels yet. Use the Labels panel.
              </div>
            ) : null}
            {tagLabels.map((label) => {
              const isActive = activeLabelId === label.id;
              return (
                <button
                  key={label.id}
                  type="button"
                  disabled={tagMutationPending}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-slate-800 ${
                    isActive ? 'bg-slate-900/60' : ''
                  }`}
                  onClick={() => {
                    void handleApplyLabel(label.id);
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: label.color }}
                    aria-hidden
                  />
                  <span className="truncate text-slate-200">{label.name}</span>
                </button>
              );
            })}
            {onEditTagNote ? (
              <button
                type="button"
                className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-800"
                onClick={handleEditNote}
              >
                Edit note
              </button>
            ) : null}
            {hasTagOrNote ? (
              <button
                type="button"
                disabled={tagMutationPending}
                className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-800"
                onClick={() => {
                  void handleApplyLabel(null);
                }}
              >
                Clear label
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="mt-1 border-t border-slate-800 pt-1">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">Columns</div>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-800"
            onClick={() => {
              handleToggleColumn(contextMenu.columnId);
              closeMenu();
            }}
          >
            {columnVisible ? 'Hide column' : 'Show column'}
          </button>
        </div>
      </div>
    );

    return createPortal(menu, document.body);
  };

  return (
  <div
  ref={gridContainerRef}
  className={`${themeClass} h-full w-full`}
  style={{ fontFamily: 'var(--data-font-family)', fontSize: 'var(--data-font-size)' }}
    onContextMenu={(e) => e.preventDefault()}
    >
      {showPlaceholder ? (
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Select a CSV or TSV file to begin.
        </div>
      ) : (
        <AgGridReact<GridRow>
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          suppressContextMenu
          rowSelection="multiple"
          rowMultiSelectWithClick
          animateRows
          rowModelType="infinite"
          cacheBlockSize={500}
          maxBlocksInCache={2}
          getRowId={(params) => (params.data ? String(params.data.__rowId) : '')}
          tooltipShowDelay={0}
          getRowClass={(params) =>
            typeof params.data?.__rowId === 'number' &&
            Number.isFinite(params.data.__rowId) &&
            params.data.__rowId === keyboardFocusedRowId
              ? 'ag-row-keyboard-active'
              : undefined
          }
          onCellContextMenu={handleCellContextMenu}
          onSortChanged={handleSortChanged}
          onSelectionChanged={(event: SelectionChangedEvent) => {
            const nodes = event.api?.getSelectedNodes?.() ?? [];
            const anchor = nodes[nodes.length - 1];
            const rowId =
              typeof anchor?.data?.__rowId === 'number' && Number.isFinite(anchor.data.__rowId)
                ? anchor.data.__rowId
                : null;
            setKeyboardFocusedRowId(rowId);
          }}
          onGridReady={(event: GridReadyEvent) => {
            setGridApi(event.api);
            setColumnApi(event.columnApi);
          }}
        />
      )}
      {renderContextMenu()}
    </div>
  );
};

export default DataGrid;
