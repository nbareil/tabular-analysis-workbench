import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AgGridReact } from 'ag-grid-react';
import type {
  CellContextMenuEvent,
  ColumnState,
  SortChangedEvent
} from 'ag-grid-community';

import { useAppStore } from '@state/appStore';
import { useDataStore, type GridRow, type LoaderStatus } from '@state/dataStore';
import type { FilterState, SessionSnapshot } from '@state/sessionStore';
import { useSessionStore } from '@state/sessionStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import { useSortSync } from '@/hooks/useSortSync';

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
    (filter) => filter.column === columnId && filter.operator === 'eq'
  );

  const eqMatchesValue =
    eqIndex >= 0 &&
    String(filters[eqIndex]!.value ?? '') === valueAsString &&
    !filters[eqIndex]!.fuzzy;

  const neqExists = filters.some(
    (filter) =>
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
}

interface DataGridProps {
  status: LoaderStatus;
}

const DataGrid = ({ status }: DataGridProps): JSX.Element => {
  const columns = useDataStore((state) => state.columns);
  const rows = useDataStore((state) => state.searchRows ?? state.filteredRows ?? state.rows);
  const theme = useAppStore((state) => state.theme);
  const { filters, applyFilters } = useFilterSync();
  const { sorts, applySorts } = useSortSync();
  const [contextMenu, setContextMenu] = useState<FilterContextMenuState | null>(null);
  const columnLayout = useSessionStore((state) => state.columnLayout);
  const setColumnLayout = useSessionStore((state) => state.setColumnLayout);
  const gridRef = useRef<AgGridReact<GridRow>>(null);

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
    const columnApi = gridRef.current?.columnApi;
    if (!columnApi) {
      return;
    }

    columnApi.applyColumnState({
      state: orderedColumns.map((column, index) => ({
        colId: column.key,
        hide: columnLayout.visibility[column.key] === false,
        order: index
      })),
      applyOrder: true
    });
  }, [orderedColumns, columnLayout.visibility]);

  const columnDefs = useMemo(
    () =>
      orderedColumns.map((column) => ({
        field: column.key,
        headerName: column.headerName,
        cellDataType: column.type,
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
    [columnLayout.visibility, orderedColumns, sorts]
  );

  const defaultColDef = useMemo(
    () => ({
      flex: 1,
      minWidth: 140,
      resizable: true
    }),
    []
  );

  const themeClass = theme === 'dark' ? 'ag-theme-quartz-dark' : 'ag-theme-quartz';
  const showPlaceholder = status !== 'loading' && rows.length === 0;
  const menuMetadata = useMemo(() => {
    if (!contextMenu) {
      return null;
    }

    return evaluateFilterMenuMetadata(filters, contextMenu.columnId, contextMenu.displayValue);
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

  const handleCellContextMenu = useCallback(
    (params: CellContextMenuEvent<GridRow>) => {
      const mouseEvent = params.event as MouseEvent;
      mouseEvent.preventDefault();

      const columnId = params.column?.getColId();
      if (!columnId) {
        return;
      }

      const rawValue = params.value;
      if (rawValue == null) {
        return;
      }

      const displayValue = typeof rawValue === 'string' ? rawValue : String(rawValue);

      const menuWidth = 200;
      const menuHeight = 96;
      let x = mouseEvent.clientX;
      let y = mouseEvent.clientY;

      if (x + menuWidth > window.innerWidth) {
        x = Math.max(0, window.innerWidth - menuWidth - 8);
      }

      if (y + menuHeight > window.innerHeight) {
        y = Math.max(0, window.innerHeight - menuHeight - 8);
      }

      setContextMenu({
        x,
        y,
        columnId,
        displayValue
      });
    },
    []
  );

  const handleFilterIn = useCallback(() => {
    if (!contextMenu || !menuMetadata) {
      return;
    }

    if (menuMetadata.eqMatchesValue) {
      closeMenu();
      return;
    }

    if (menuMetadata.eqIndex >= 0) {
      const nextFilters = filters.slice();
      nextFilters[menuMetadata.eqIndex] = {
        ...nextFilters[menuMetadata.eqIndex]!,
        operator: 'eq',
        value: contextMenu.displayValue,
        value2: undefined,
        fuzzy: undefined
      };
      void applyFilters(nextFilters);
    } else {
      const predicate: FilterState = {
        id: crypto.randomUUID(),
        column: contextMenu.columnId,
        operator: 'eq',
        value: contextMenu.displayValue,
        caseSensitive: false
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

    const predicate: FilterState = {
      id: crypto.randomUUID(),
      column: contextMenu.columnId,
      operator: 'neq',
      value: contextMenu.displayValue,
      caseSensitive: false
    };
    void applyFilters([...filters, predicate]);
    closeMenu();
  }, [applyFilters, closeMenu, contextMenu, filters, menuMetadata]);

  const handleSortChanged = useCallback(
    (event: SortChangedEvent) => {
      const columnState = event.columnApi.getColumnState();
      const nextSorts = buildSortStateFromColumnState(columnState);

      if (!sortsEqual(nextSorts, sorts)) {
        void applySorts(nextSorts);
      }
    },
    [applySorts, sorts]
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

      const api = gridRef.current?.api;
      if (api) {
        api.setColumnVisible(columnId, !visible);
      }
    },
    [columnLayout, setColumnLayout]
  );

  const renderContextMenu = () => {
    if (!contextMenu || !menuMetadata) {
      return null;
    }

    const columnVisible = columnLayout.visibility[contextMenu.columnId] !== false;

    const menu = (
      <div
        data-grid-context-menu="true"
        className="fixed z-50 min-w-[12rem] rounded border border-slate-700 bg-slate-900 p-1 text-xs text-slate-200 shadow-xl"
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
      className={`${themeClass} h-full w-full`}
      style={{ fontFamily: 'var(--data-font-family)', fontSize: 'var(--data-font-size)' }}
    >
      {showPlaceholder ? (
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Select a CSV or TSV file to begin.
        </div>
      ) : (
        <AgGridReact<GridRow>
          ref={gridRef}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowData={rows}
          suppressRowClickSelection
          suppressContextMenu
          rowSelection="multiple"
          animateRows
          getRowId={(params) => (params.data ? String(params.data.__rowId) : '')}
          tooltipShowDelay={0}
          onCellContextMenu={handleCellContextMenu}
          onSortChanged={handleSortChanged}
        />
      )}
      {renderContextMenu()}
    </div>
  );
};

export default DataGrid;
