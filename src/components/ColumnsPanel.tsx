import { useMemo, useState } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';

interface ColumnsPanelProps {
  open: boolean;
  onClose: () => void;
}

const ColumnsPanel = ({ open, onClose }: ColumnsPanelProps): JSX.Element | null => {
  const columns = useDataStore((state) => state.columns);
  const columnLayout = useSessionStore((state) => state.columnLayout);
  const setColumnLayout = useSessionStore((state) => state.setColumnLayout);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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

  const currentOrder = useMemo(() => orderedColumns.map((column) => column.key), [orderedColumns]);

  const reorderColumns = (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex) {
      return;
    }

    const nextOrder = [...currentOrder];
    const [moved] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);

    setColumnLayout({
      order: nextOrder,
      visibility: columnLayout.visibility
    });
  };

  const handleToggle = (columnKey: string) => {
    const current = columnLayout.visibility[columnKey] !== false;
    const nextVisibility = {
      ...columnLayout.visibility,
      [columnKey]: !current
    };
    setColumnLayout({
      order: currentOrder,
      visibility: nextVisibility
    });
  };

  const handleSelectAll = () => {
    const nextVisibility: Record<string, boolean> = {};
    for (const column of columns) {
      nextVisibility[column.key] = true;
    }
    setColumnLayout({
      order: currentOrder,
      visibility: nextVisibility
    });
  };

  const handleClearAll = () => {
    const nextVisibility: Record<string, boolean> = {};
    for (const column of columns) {
      nextVisibility[column.key] = false;
    }
    setColumnLayout({
      order: currentOrder,
      visibility: nextVisibility
    });
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70">
      <div className="w-full max-w-lg rounded border border-slate-700 bg-slate-900 shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Columns</h2>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
              onClick={handleSelectAll}
            >
              Show all
            </button>
            <button
              type="button"
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
              onClick={handleClearAll}
            >
              Hide all
            </button>
            <button
              type="button"
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </header>
        <div className="max-h-96 overflow-auto px-4 py-3 text-sm text-slate-200">
          {orderedColumns.length === 0 ? (
            <p className="text-xs text-slate-400">No columns available. Load a dataset first.</p>
          ) : (
            <ul className="space-y-2">
              {orderedColumns.map((column, index) => {
                const visible = columnLayout.visibility[column.key] !== false;
                return (
                  <li
                    key={column.key}
                    className="flex cursor-move items-center justify-between gap-3 rounded border border-slate-800 px-3 py-2 hover:bg-slate-800"
                    draggable
                    onDragStart={(event) => {
                      setDragIndex(index);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', String(index));
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const source = dragIndex ?? Number(event.dataTransfer.getData('text/plain'));
                      if (!Number.isNaN(source)) {
                        reorderColumns(source, index);
                      }
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                  >
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={visible}
                        onChange={() => handleToggle(column.key)}
                      />
                      <span className="font-medium">{column.headerName}</span>
                    </label>
                    <span className="text-xs uppercase text-slate-500">{column.type}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default ColumnsPanel;
