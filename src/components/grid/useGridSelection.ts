import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { GridApi, IRowNode, RowClassRules, RowSelectedEvent } from 'ag-grid-community';

import type { GridRow } from '@state/dataStore';
import { getNextRowIndex, toggleRowSelection } from './gridUtils';

const FOCUS_CLASS = 'ag-row-keyboard-active';

export interface GridSelection {
  /** Selected row ids, including rows whose grid blocks were evicted from AG Grid's cache. */
  getSelectedRowIds: () => number[];
  focusedRowId: () => number | null;
  onRowSelected: (event: RowSelectedEvent<GridRow>) => void;
  /** Re-marks freshly loaded nodes that were selected before their block was evicted. */
  restoreSelection: (rows: GridRow[]) => void;
  clear: () => void;
  rowClassRules: RowClassRules<GridRow>;
}

const rowIdOf = (node: IRowNode<GridRow> | null | undefined): number | null =>
  typeof node?.data?.__rowId === 'number' ? node.data.__rowId : null;

export const useGridSelection = (
  gridApi: GridApi<GridRow> | null,
  containerRef: RefObject<HTMLDivElement>
): GridSelection => {
  const selected = useRef(new Set<number>());
  const focused = useRef<number | null>(null);
  const restoring = useRef(false);

  const setFocused = useCallback(
    (rowId: number | null) => {
      const previous = focused.current;
      focused.current = rowId;
      if (!gridApi || previous === rowId) {
        return;
      }
      const nodes = [previous, rowId]
        .map((id) => (id == null ? undefined : gridApi.getRowNode(String(id))))
        .filter((node): node is IRowNode<GridRow> => Boolean(node));
      gridApi.redrawRows({ rowNodes: nodes });
    },
    [gridApi]
  );

  const onRowSelected = useCallback(
    (event: RowSelectedEvent<GridRow>) => {
      const rowId = rowIdOf(event.node);
      if (rowId == null || restoring.current) {
        return;
      }
      if (event.node.isSelected()) {
        selected.current.add(rowId);
        setFocused(rowId);
      } else {
        selected.current.delete(rowId);
      }
    },
    [setFocused]
  );

  const restoreSelection = useCallback(
    (rows: GridRow[]) => {
      if (!gridApi || selected.current.size === 0) {
        return;
      }
      requestAnimationFrame(() => {
        restoring.current = true;
        for (const row of rows) {
          if (selected.current.has(row.__rowId)) {
            gridApi.getRowNode(String(row.__rowId))?.setSelected(true, false, 'api');
          }
        }
        restoring.current = false;
      });
    },
    [gridApi]
  );

  const clear = useCallback(() => {
    selected.current.clear();
    focused.current = null;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!gridApi || !container) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }

      if (event.key === ' ') {
        if (toggleRowSelection(gridApi, focused.current)) {
          event.preventDefault();
        }
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }

      const currentNode = focused.current == null ? null : gridApi.getRowNode(String(focused.current));
      const targetIndex = getNextRowIndex({
        rowCount: gridApi.getDisplayedRowCount(),
        currentIndex: currentNode?.rowIndex ?? null,
        direction: event.key === 'ArrowDown' ? 'down' : 'up'
      });
      if (targetIndex == null) {
        return;
      }
      event.preventDefault();

      const extend = event.shiftKey;
      const select = (): boolean => {
        const node = gridApi.getDisplayedRowAtIndex(targetIndex);
        if (!node) {
          return false;
        }
        if (!extend) {
          gridApi.deselectAll();
        }
        node.setSelected(true, false, 'api');
        setFocused(rowIdOf(node));
        gridApi.ensureIndexVisible(targetIndex);
        const firstColumn = gridApi.getAllDisplayedColumns()[0];
        if (firstColumn) {
          gridApi.setFocusedCell(targetIndex, firstColumn);
        }
        return true;
      };

      if (!select()) {
        gridApi.ensureIndexVisible(targetIndex, 'middle');
        requestAnimationFrame(select);
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef, gridApi, setFocused]);

  const rowClassRules = useRef<RowClassRules<GridRow>>({
    [FOCUS_CLASS]: (params) => params.data != null && params.data.__rowId === focused.current
  }).current;

  return {
    getSelectedRowIds: useCallback(() => Array.from(selected.current).sort((a, b) => a - b), []),
    focusedRowId: useCallback(() => focused.current, []),
    onRowSelected,
    restoreSelection,
    clear,
    rowClassRules
  };
};
