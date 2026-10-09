import { useMemo, useState } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';
import { Modal } from '@components/Modal';

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

  const buttonClass = 'rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-30';

  return (
    <Modal
      title="Columns"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonClass} onClick={handleSelectAll}>
            Show all
          </button>
          <button type="button" className={buttonClass} onClick={handleClearAll}>
            Hide all
          </button>
        </>
      }
    >
      {orderedColumns.length === 0 ? (
        <p className="text-xs text-slate-400">No columns available. Load a dataset first.</p>
      ) : (
        <ul className="space-y-2" aria-label="Column order and visibility">
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
                <label className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" className="h-4 w-4" checked={visible} onChange={() => handleToggle(column.key)} />
                  <span className="truncate font-medium">{column.headerName}</span>
                </label>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-xs uppercase text-slate-500">{column.type}</span>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={`Move ${column.headerName} up`}
                    disabled={index === 0}
                    onClick={() => reorderColumns(index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={`Move ${column.headerName} down`}
                    disabled={index === orderedColumns.length - 1}
                    onClick={() => reorderColumns(index, index + 1)}
                  >
                    ↓
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};

export default ColumnsPanel;
