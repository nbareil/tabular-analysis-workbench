import { type JSX, memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDarkBlue,
  colorSchemeLight,
  themeQuartz,
  type CellContextMenuEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type IDatasource,
  type IGetRowsParams,
  type RowSelectionOptions,
  type SortChangedEvent,
  type ValueFormatterParams
} from 'ag-grid-community';

import { useAppStore } from '@state/appStore';
import { useDataStore, type GridColumn, type GridRow, type LoaderStatus } from '@state/dataStore';
import { useTagStore } from '@state/tagStore';
import { useSessionStore, type FilterState } from '@state/sessionStore';
import { getDataWorker } from '@workers/dataWorkerProxy';
import { parseDatetime } from '@workers/valueParsing';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from '@workers/types';
import { buildTagCellValue, type TagCellValue } from '@utils/tagCells';
import { formatDatetimeForDisplay } from '@utils/datetimeFormat';
import { reportAppError } from '@utils/diagnostics';
import { useFilterSync } from '@/hooks/useFilterSync';
import { useSortSync } from '@/hooks/useSortSync';
import { DataGridHeader, HighlightCell, MarkdownTooltip, TagCellRenderer } from './grid/GridCells';
import { CellContextMenu } from './grid/CellContextMenu';
import { HeaderContextMenu } from './grid/HeaderContextMenu';
import { TimeWindowDialog } from './grid/TimeWindowDialog';
import { ColumnProfileDialog } from './grid/ColumnProfileDialog';
import { TimelinePanel } from './grid/TimelinePanel';
import { useAutoColumnWidths } from './grid/useAutoColumnWidths';
import { useGridSelection } from './grid/useGridSelection';
import {
  MIN_COLUMN_WIDTH,
  buildSortStateFromColumnState,
  evaluateFilterMenuMetadata,
  formatClipboardCellValue,
  getEmptyStateMessage,
  getHeaderContextMenuColumnId,
  isWithinGridContextMenu,
  serializeRowsForClipboard,
  shouldShowEmptyOverlay,
  shouldShowInitialPlaceholder,
  sortsEqual,
  type GridContextMenuState
} from './grid/gridUtils';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridFont = { fontFamily: 'var(--data-font-family)', fontSize: 'var(--data-font-size)' };
const GRID_THEMES = {
  light: themeQuartz.withPart(colorSchemeLight).withParams(gridFont),
  dark: themeQuartz.withPart(colorSchemeDarkBlue).withParams(gridFont)
};
const ROW_SELECTION: RowSelectionOptions = {
  mode: 'multiRow',
  checkboxes: true,
  headerCheckbox: false,
  enableClickSelection: true,
  enableSelectionWithoutKeys: true
};
const SELECTION_COLUMN = { pinned: 'left' as const, width: 44 };

const CACHE_BLOCK_SIZE = 500;
const MAX_BLOCKS_IN_CACHE = 40;

interface DataGridProps {
  status: LoaderStatus;
  searchQuery: string;
  onEditTagNote?: (payload: { rowId: number }) => void;
}

const placeMenu = (x: number, y: number, width: number, height: number) => ({
  x: Math.max(0, Math.min(x, window.innerWidth - width - 8)),
  y: Math.max(0, Math.min(y, window.innerHeight - height - 8))
});

const datetimeFilter = (column: string, start: number, end: number): FilterState => ({
  id: crypto.randomUUID(),
  column,
  operator: 'between',
  value: start,
  value2: end,
  rawValue: new Date(start).toISOString().slice(0, 16),
  rawValue2: new Date(end).toISOString().slice(0, 16),
  enabled: true
});

const DataGrid = ({ status, searchQuery, onEditTagNote }: DataGridProps): JSX.Element => {
  const columns = useDataStore((state) => state.columns);
  const matchedRows = useDataStore((state) => state.matchedRows);
  const viewVersion = useDataStore((state) => state.viewVersion);
  const totalRows = useDataStore((state) => state.totalRows);
  const loadId = useDataStore((state) => state.loadId);
  const navigation = useDataStore((state) => state.navigation);
  const loadColumnValueDistribution = useDataStore((state) => state.loadColumnValueDistribution);
  const theme = useAppStore((state) => state.theme);
  const displayTimeZone = useAppStore((state) => state.displayTimeZone);
  const searchCaseSensitive = useAppStore((state) => state.searchCaseSensitive);
  const columnLayout = useSessionStore((state) => state.columnLayout);
  const setColumnLayout = useSessionStore((state) => state.setColumnLayout);
  const tagLabels = useTagStore((state) => state.labels);
  const tagRecords = useTagStore((state) => state.tags);
  const applyTagToRows = useTagStore((state) => state.applyTag);
  const clearTagFromRows = useTagStore((state) => state.clearTag);
  const { filters, applyFilters } = useFilterSync();
  const { sorts, applySorts } = useSortSync();

  const [gridApi, setGridApi] = useState<GridApi<GridRow> | null>(null);
  const [contextMenu, setContextMenu] = useState<GridContextMenuState | null>(null);
  const [timeWindow, setTimeWindow] = useState<{ column: string; center: number } | null>(null);
  const [profiledColumn, setProfiledColumn] = useState<string | null>(null);
  const [timelineColumn, setTimelineColumn] = useState<string | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selection = useGridSelection(gridApi, containerRef);
  const autoWidths = useAutoColumnWidths(columns, status, totalRows, loadId);
  const headerDistributionEntry = useDataStore((state) =>
    contextMenu?.kind === 'header' ? state.columnValueDistributions[contextMenu.columnId] : undefined
  );

  // Columns that appear later (or a reset layout) join the layout at the end, visible.
  useEffect(() => {
    const missing = columns.filter((column) => !columnLayout.order.includes(column.key));
    if (!missing.length) {
      return;
    }
    setColumnLayout({
      order: [...columnLayout.order, ...missing.map((column) => column.key)],
      visibility: {
        ...Object.fromEntries(missing.map((column) => [column.key, true])),
        ...columnLayout.visibility
      }
    });
  }, [columnLayout, columns, setColumnLayout]);

  const orderedColumns = useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    return columnLayout.order
      .map((key) => byKey.get(key))
      .filter((column): column is GridColumn => Boolean(column));
  }, [columnLayout.order, columns]);

  useEffect(() => {
    gridApi?.applyColumnState({
      state: orderedColumns.map((column) => ({
        colId: column.key,
        hide: columnLayout.visibility[column.key] === false,
        ...(autoWidths[column.key] != null ? { width: Math.round(autoWidths[column.key]!) } : {})
      })),
      applyOrder: true
    });
  }, [autoWidths, columnLayout.visibility, gridApi, orderedColumns]);

  const tagDataRef = useRef({ tags: tagRecords, labels: new Map(tagLabels.map((label) => [label.id, label])) });
  useEffect(() => {
    tagDataRef.current = { tags: tagRecords, labels: new Map(tagLabels.map((label) => [label.id, label])) };
    gridApi?.refreshCells({ columns: [TAG_COLUMN_ID], force: true, suppressFlash: true });
  }, [gridApi, tagLabels, tagRecords]);

  const handleOpenHeaderMenu = useCallback((columnId: string, anchorRect: DOMRect) => {
    setContextMenu({ kind: 'header', ...placeMenu(anchorRect.left, anchorRect.bottom + 4, 288, 360), columnId });
  }, []);

  const tagColumnDef = useMemo<ColDef<GridRow>>(
    () => ({
      colId: TAG_COLUMN_ID,
      headerName: 'Labels',
      headerTooltip: 'Row labels',
      pinned: 'left',
      lockPosition: true,
      sortable: false,
      resizable: false,
      suppressSizeToFit: true,
      width: 160,
      minWidth: 140,
      maxWidth: 220,
      cellRenderer: TagCellRenderer,
      valueGetter: (params) =>
        buildTagCellValue(params.data?.__rowId, tagDataRef.current.tags, tagDataRef.current.labels),
      tooltipComponent: MarkdownTooltip
    }),
    []
  );

  const dataColumnDefs = useMemo<ColDef<GridRow>[]>(
    () =>
      orderedColumns.map((column) => {
        const sortIndex = sorts.findIndex((sort) => sort.column === column.key);
        return {
          field: column.key,
          colId: column.key,
          headerName: column.headerName,
          cellDataType: false,
          sortable: true,
          headerComponent: DataGridHeader,
          headerComponentParams: { openHeaderMenu: handleOpenHeaderMenu },
          headerTooltip: column.confidence > 0 ? `${column.type} • ${column.confidence}% confidence` : column.type,
          hide: columnLayout.visibility[column.key] === false,
          valueFormatter:
            column.type === 'datetime' && displayTimeZone !== 'original'
              ? (params: ValueFormatterParams<GridRow>) =>
                  formatDatetimeForDisplay(String(params.value ?? ''), displayTimeZone)
              : undefined,
          cellRenderer: searchQuery.trim() ? HighlightCell : undefined,
          cellRendererParams: { query: searchQuery, caseSensitive: searchCaseSensitive },
          ...(sortIndex >= 0 ? { sort: sorts[sortIndex]!.direction, sortIndex } : { sort: null })
        };
      }),
    [columnLayout.visibility, displayTimeZone, handleOpenHeaderMenu, orderedColumns, searchCaseSensitive, searchQuery, sorts]
  );

  const columnDefs = useMemo(() => [tagColumnDef, ...dataColumnDefs], [dataColumnDefs, tagColumnDef]);
  const defaultColDef = useMemo(() => ({ minWidth: MIN_COLUMN_WIDTH, resizable: true }), []);

  // A new datasource per view version: the worker's row order changed, so cached blocks are stale.
  useEffect(() => {
    if (!gridApi || gridApi.isDestroyed()) {
      return;
    }
    selection.clear();
    const datasource: IDatasource = {
      getRows: async (params: IGetRowsParams) => {
        try {
          const response = await getDataWorker().fetchRows({
            offset: params.startRow,
            limit: params.endRow - params.startRow
          });
          params.successCallback(response.rows as GridRow[], response.matchedRows);
          selection.restoreSelection(response.rows as GridRow[]);
        } catch (error) {
          reportAppError('Failed to fetch rows', error, {
            operation: 'grid.fetchRows',
            context: { startRow: params.startRow, endRow: params.endRow }
          });
          params.failCallback();
        }
      }
    };
    gridApi.setGridOption('datasource', datasource);
    // selection's callbacks are stable; listing the object would reset the datasource every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridApi, viewVersion]);

  // While streaming, show the first rows as soon as they exist, then refresh once loading completes.
  const shownRowsRef = useRef<{ loadId: number; streamed: boolean } | null>(null);
  useEffect(() => {
    if (!gridApi || gridApi.isDestroyed() || totalRows <= 0) {
      return;
    }
    const shown = shownRowsRef.current;
    if (status === 'loading' && shown?.loadId !== loadId) {
      shownRowsRef.current = { loadId, streamed: true };
      gridApi.refreshInfiniteCache();
    } else if (status === 'ready' && (shown?.loadId !== loadId || shown.streamed)) {
      shownRowsRef.current = { loadId, streamed: false };
      gridApi.refreshInfiniteCache();
    }
  }, [gridApi, loadId, status, totalRows]);

  const focusPosition = useCallback(
    (position: number) => {
      if (!gridApi || position < 0) {
        return;
      }
      gridApi.ensureIndexVisible(position, 'middle');
      const select = () => {
        const node = gridApi.getDisplayedRowAtIndex(position);
        if (!node?.data) {
          return false;
        }
        gridApi.deselectAll();
        node.setSelected(true, false, 'api');
        const firstColumn = gridApi.getAllDisplayedColumns()[0];
        if (firstColumn) {
          gridApi.setFocusedCell(position, firstColumn);
        }
        return true;
      };
      if (!select()) {
        // The block holding this row is still loading.
        setTimeout(select, 150);
      }
    },
    [gridApi]
  );

  useEffect(() => {
    if (!navigation || !gridApi) {
      return;
    }
    const worker = getDataWorker();
    const focusedRowId = selection.focusedRowId();
    const currentPosition = async (): Promise<number> =>
      focusedRowId == null ? -1 : worker.findRowPosition(focusedRowId);

    const run = async () => {
      switch (navigation.kind) {
        case 'row': {
          const position = await worker.findRowPosition(navigation.rowId);
          if (position < 0) {
            reportAppError(`Row ${navigation.rowId + 1} is not in the current view`, null, { operation: 'grid.jump' });
          }
          focusPosition(position);
          return;
        }
        case 'next':
        case 'previous': {
          const from = await currentPosition();
          const target = navigation.kind === 'next' ? from + 1 : Math.max(0, from - 1);
          focusPosition(Math.min(target, gridApi.getDisplayedRowCount() - 1));
          return;
        }
        default: {
          const from = await currentPosition();
          const position = await worker.findTaggedPosition(
            navigation.kind === 'nextLabelled' ? from : from < 0 ? gridApi.getDisplayedRowCount() : from,
            navigation.kind === 'nextLabelled' ? 'next' : 'previous'
          );
          focusPosition(position);
        }
      }
    };
    void run();
    // Only a new navigation request should trigger a move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (!isWithinGridContextMenu(event.target)) {
        closeMenu();
      }
    };
    // Close when the user scrolls, not on programmatic scrolls (AG Grid scrolling a focused
    // header into view would otherwise close a menu the moment it opens).
    const handleUserScroll = (event: Event) => {
      if (!isWithinGridContextMenu(event.target)) {
        closeMenu();
      }
    };
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('wheel', handleUserScroll, { capture: true, passive: true });
    window.addEventListener('touchmove', handleUserScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('wheel', handleUserScroll, true);
      window.removeEventListener('touchmove', handleUserScroll, true);
    };
  }, [closeMenu, contextMenu]);

  useEffect(() => {
    if (contextMenu?.kind === 'header') {
      void loadColumnValueDistribution(contextMenu.columnId);
    }
  }, [contextMenu, loadColumnValueDistribution]);

  const targetRowIds = useCallback(
    (rowId: number | null): number[] => {
      const selected = selection.getSelectedRowIds();
      return rowId == null || selected.includes(rowId) ? selected : [rowId];
    },
    [selection]
  );

  const handleCellContextMenu = useCallback(
    (params: CellContextMenuEvent<GridRow>) => {
      const event = params.event as MouseEvent;
      event.preventDefault();
      const columnId = params.column?.getColId();
      if (!columnId) {
        return;
      }
      const isTagColumn = columnId === TAG_COLUMN_ID;
      const rowId = typeof params.data?.__rowId === 'number' ? params.data.__rowId : null;
      if (rowId != null && !selection.getSelectedRowIds().includes(rowId)) {
        params.api.deselectAll();
        params.node.setSelected(true, false, 'api');
      }

      let displayValue: string;
      let filterValue: string | null;
      if (isTagColumn) {
        const tagValue = (params.value as TagCellValue | null) ?? null;
        const names = tagValue?.labels.map((label) => label.name).filter(Boolean) ?? [];
        displayValue = names.length ? names.join(', ') : 'No label';
        filterValue = tagValue?.labels[0]?.id ?? TAG_NO_LABEL_FILTER_VALUE;
      } else {
        displayValue = String(params.value ?? '');
        filterValue = displayValue;
      }

      setContextMenu({
        kind: 'cell',
        ...placeMenu(event.clientX, event.clientY, 240, isTagColumn ? 160 + tagLabels.length * 28 : 220),
        columnId,
        displayValue,
        filterValue,
        rowId,
        cellClipboardText: formatClipboardCellValue(params.value)
      });
    },
    [selection, tagLabels.length]
  );

  const handleContainerContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const columnId = getHeaderContextMenuColumnId(event.target);
    if (!columnId) {
      return;
    }
    event.preventDefault();
    setContextMenu({ kind: 'header', ...placeMenu(event.clientX, event.clientY, 288, 360), columnId });
  }, []);

  const hideColumn = useCallback(
    (columnId: string) => {
      setColumnLayout({ order: columnLayout.order, visibility: { ...columnLayout.visibility, [columnId]: false } });
      closeMenu();
    },
    [closeMenu, columnLayout, setColumnLayout]
  );

  const eqValuesFor = useCallback(
    (columnId: string) =>
      new Set(
        filters
          .filter((filter) => filter.enabled !== false && filter.column === columnId && filter.operator === 'eq')
          .map((filter) => String(filter.value ?? ''))
      ),
    [filters]
  );

  const eqFilter = (column: string, value: string): FilterState => ({
    id: crypto.randomUUID(),
    column,
    operator: 'eq',
    value,
    caseSensitive: false,
    enabled: true
  });

  const toggleValueFilter = (columnId: string, value: string) => {
    const without = filters.filter(
      (filter) => !(filter.column === columnId && filter.operator === 'eq' && String(filter.value ?? '') === value)
    );
    void applyFilters(eqValuesFor(columnId).has(value) ? without : [...without, eqFilter(columnId, value)]);
  };

  const onlyValueFilter = (columnId: string, value: string) => {
    void applyFilters([
      ...filters.filter((filter) => !(filter.column === columnId && filter.operator === 'eq')),
      eqFilter(columnId, value)
    ]);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      reportAppError('Failed to copy to clipboard', error, { operation: 'grid.copy' });
    }
    closeMenu();
  };

  const copyRows = async (rowId: number | null) => {
    if (!gridApi) {
      return;
    }
    const rows = await getDataWorker().getRowsById(targetRowIds(rowId));
    const displayed = gridApi.getAllDisplayedColumns();
    const { tags, labels } = tagDataRef.current;
    await copyText(
      serializeRowsForClipboard(
        rows.map((row) =>
          displayed.map((column) => {
            const columnId = column.getColId();
            return {
              headerName: String(column.getColDef().headerName ?? columnId),
              value: columnId === TAG_COLUMN_ID ? buildTagCellValue(row.__rowId, tags, labels) : row[columnId]
            };
          })
        )
      )
    );
  };

  const applyLabel = async (rowId: number | null, labelId: string | null) => {
    const rowIds = targetRowIds(rowId);
    if (!rowIds.length || tagBusy) {
      return;
    }
    setTagBusy(true);
    try {
      if (labelId === null) {
        await clearTagFromRows(rowIds);
      } else {
        await applyTagToRows({ rowIds, labelIds: [labelId], mode: 'append' });
      }
    } finally {
      setTagBusy(false);
      closeMenu();
    }
  };

  const handleSortChanged = useCallback(
    (event: SortChangedEvent<GridRow>) => {
      const nextSorts = buildSortStateFromColumnState(event.api.getColumnState());
      if (!sortsEqual(nextSorts, sorts)) {
        void applySorts(nextSorts);
      }
    },
    [applySorts, sorts]
  );

  // Grid-scoped shortcuts that act on the focused row.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      const focusedRowId = selection.focusedRowId();
      if (event.key.toLowerCase() === 't' && focusedRowId != null && onEditTagNote) {
        event.preventDefault();
        onEditTagNote({ rowId: focusedRowId });
      } else if (event.key === ']') {
        event.preventDefault();
        useDataStore.getState().navigateGrid({ kind: 'nextLabelled' });
      } else if (event.key === '[') {
        event.preventDefault();
        useDataStore.getState().navigateGrid({ kind: 'previousLabelled' });
      }
    };
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [onEditTagNote, selection]);

  const showPlaceholder = shouldShowInitialPlaceholder({ status, totalRows, columnCount: columns.length });
  const showEmptyOverlay = shouldShowEmptyOverlay({ status, totalRows, matchedRows, columnCount: columns.length });
  const emptyStateMessage = getEmptyStateMessage({ status, totalRows, matchedRows });

  const renderMenu = () => {
    if (!contextMenu) {
      return null;
    }
    const column = columns.find((entry) => entry.key === contextMenu.columnId);
    if (contextMenu.kind === 'header') {
      const columnId = contextMenu.columnId;
      return (
        <HeaderContextMenu
          menu={contextMenu}
          column={column}
          distributionEntry={headerDistributionEntry}
          selectedValues={eqValuesFor(columnId)}
          onRetryDistribution={() => void loadColumnValueDistribution(columnId)}
          onToggleValue={(value) => toggleValueFilter(columnId, value)}
          onOnlyValue={(value) => onlyValueFilter(columnId, value)}
          onHideColumn={() => hideColumn(columnId)}
          onProfileColumn={() => {
            setProfiledColumn(columnId);
            closeMenu();
          }}
          onShowTimeline={() => {
            setTimelineColumn(columnId);
            closeMenu();
          }}
          onClose={closeMenu}
        />
      );
    }

    const isLabelColumn = contextMenu.columnId === TAG_COLUMN_ID;
    const value = contextMenu.filterValue ?? '';
    const predicateValue = isLabelColumn ? value || TAG_NO_LABEL_FILTER_VALUE : value;
    const metadata = evaluateFilterMenuMetadata(filters, contextMenu.columnId, value);
    const center = column?.type === 'datetime' ? parseDatetime(value) : null;
    const filterIn = () => {
      const next = filters.slice();
      const predicate = { ...eqFilter(contextMenu.columnId, predicateValue), caseSensitive: false };
      if (metadata.eqIndex >= 0) {
        next[metadata.eqIndex] = { ...next[metadata.eqIndex]!, value: predicateValue, value2: undefined, enabled: true };
      } else {
        next.push(predicate);
      }
      void applyFilters(next);
      closeMenu();
    };

    return (
      <CellContextMenu
        menu={contextMenu}
        metadata={metadata}
        isLabelColumn={isLabelColumn}
        isDatetimeColumn={center != null}
        labels={tagLabels}
        activeRecord={contextMenu.rowId != null ? tagRecords[contextMenu.rowId] : undefined}
        targetRowCount={targetRowIds(contextMenu.rowId).length}
        tagBusy={tagBusy}
        canCopy={typeof navigator.clipboard?.writeText === 'function'}
        onCopyRows={() => void copyRows(contextMenu.rowId)}
        onCopyCell={() => void copyText(contextMenu.cellClipboardText)}
        onFilterIn={filterIn}
        onFilterOut={() => {
          void applyFilters([...filters, { ...eqFilter(contextMenu.columnId, predicateValue), operator: 'neq' }]);
          closeMenu();
        }}
        onFilterTimeWindow={() => {
          if (center != null) {
            setTimeWindow({ column: contextMenu.columnId, center });
          }
          closeMenu();
        }}
        onApplyLabel={(labelId) => void applyLabel(contextMenu.rowId, labelId)}
        onEditNote={
          onEditTagNote && contextMenu.rowId != null
            ? () => {
                onEditTagNote({ rowId: contextMenu.rowId! });
                closeMenu();
              }
            : null
        }
        onHideColumn={() => hideColumn(contextMenu.columnId)}
        onClose={closeMenu}
      />
    );
  };

  const applyTimeRange = (column: string, start: number, end: number) =>
    void applyFilters([
      ...filters.filter((filter) => !(filter.column === column && filter.operator === 'between')),
      datetimeFilter(column, start, end)
    ]);

  return (
    <div className="flex h-full w-full flex-col">
      {timelineColumn ? (
        <TimelinePanel
          column={timelineColumn}
          onSelectRange={(start, end) => applyTimeRange(timelineColumn, start, end)}
          onClose={() => setTimelineColumn(null)}
        />
      ) : null}
      <div
        ref={containerRef}
        className="min-h-0 w-full flex-1"
        style={{ fontFamily: 'var(--data-font-family)', fontSize: 'var(--data-font-size)' }}
        onContextMenu={handleContainerContextMenu}
      >
        {showPlaceholder ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">{emptyStateMessage}</div>
        ) : (
          <div className="relative h-full w-full">
            <AgGridReact<GridRow>
              theme={GRID_THEMES[theme]}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              suppressContextMenu
              suppressFieldDotNotation
              rowSelection={ROW_SELECTION}
              selectionColumnDef={SELECTION_COLUMN}
              rowModelType="infinite"
              cacheBlockSize={CACHE_BLOCK_SIZE}
              maxBlocksInCache={MAX_BLOCKS_IN_CACHE}
              getRowId={(params) => String(params.data.__rowId)}
              tooltipShowDelay={0}
              rowClassRules={selection.rowClassRules}
              onCellContextMenu={handleCellContextMenu}
              onSortChanged={handleSortChanged}
              onRowSelected={selection.onRowSelected}
              onGridReady={(event: GridReadyEvent<GridRow>) => setGridApi(event.api)}
            />
            {showEmptyOverlay ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/60 text-sm text-slate-300">
                {emptyStateMessage}
              </div>
            ) : null}
          </div>
        )}
        {renderMenu()}
      </div>
      {timeWindow ? (
        <TimeWindowDialog
          column={timeWindow.column}
          center={timeWindow.center}
          onApply={(start, end) => {
            applyTimeRange(timeWindow.column, start, end);
            setTimeWindow(null);
          }}
          onClose={() => setTimeWindow(null)}
        />
      ) : null}
      {profiledColumn ? <ColumnProfileDialog column={profiledColumn} onClose={() => setProfiledColumn(null)} /> : null}
    </div>
  );
};

export default memo(DataGrid);
