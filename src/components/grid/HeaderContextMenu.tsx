import { type JSX, useState } from 'react';

import type { ColumnValueDistributionCacheEntry, GridColumn } from '@state/dataStore';
import { GridMenu, MenuItem, MenuSection } from './GridMenu';
import { sortDistributionItems, type DistributionSortOrder, type HeaderContextMenuState } from './gridUtils';

interface HeaderContextMenuProps {
  menu: HeaderContextMenuState;
  column: GridColumn | undefined;
  distributionEntry: ColumnValueDistributionCacheEntry | undefined;
  selectedValues: Set<string>;
  onRetryDistribution: () => void;
  onToggleValue: (value: string) => void;
  onOnlyValue: (value: string) => void;
  onHideColumn: () => void;
  onProfileColumn: () => void;
  onShowTimeline: () => void;
  onClose: () => void;
}

export const HeaderContextMenu = ({
  menu,
  column,
  distributionEntry,
  selectedValues,
  onRetryDistribution,
  onToggleValue,
  onOnlyValue,
  onHideColumn,
  onProfileColumn,
  onShowTimeline,
  onClose
}: HeaderContextMenuProps): JSX.Element => {
  const [sortOrder, setSortOrder] = useState<DistributionSortOrder>('desc');
  const result = distributionEntry?.result;
  const items = result && !result.skipped ? sortDistributionItems(result.items, sortOrder) : [];

  return (
    <GridMenu label={`${column?.headerName ?? menu.columnId} column`} x={menu.x} y={menu.y} onClose={onClose} className="min-w-[16rem] max-w-[18rem]">
      <MenuSection title="Column">
        <MenuItem onClick={onHideColumn}>Hide column</MenuItem>
        <MenuItem onClick={onProfileColumn}>Profile column…</MenuItem>
        {column?.type === 'datetime' ? <MenuItem onClick={onShowTimeline}>Show timeline</MenuItem> : null}
      </MenuSection>
      <MenuSection title="Value counts">
        <MenuItem onClick={() => setSortOrder((order) => (order === 'desc' ? 'asc' : 'desc'))}>
          Sort: {sortOrder === 'desc' ? 'most common first' : 'least common first'}
        </MenuItem>
        {distributionEntry?.status === 'loading' ? (
          <div className="px-2 py-1 text-[11px] text-slate-400">Loading value counts…</div>
        ) : null}
        {distributionEntry?.status === 'error' ? (
          <>
            <div className="px-2 py-1 text-[11px] text-red-400">{distributionEntry.error}</div>
            <MenuItem onClick={onRetryDistribution}>Retry</MenuItem>
          </>
        ) : null}
        {result?.skipped ? (
          <div className="px-2 py-1 text-[11px] text-slate-400">{result.skipReason ?? 'Too many unique values'}</div>
        ) : null}
        {distributionEntry?.status === 'ready' && !result?.skipped && items.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-slate-400">No values found.</div>
        ) : null}
        {items.length > 0 ? (
          <div className="max-h-52 overflow-y-auto overscroll-contain px-1 pb-1" onWheelCapture={(event) => event.stopPropagation()}>
            {items.map((item) => {
              const checked = selectedValues.has(item.value);
              return (
                <div key={item.value} className={`group flex items-center gap-1 rounded-sm ${checked ? 'bg-cyan-950/30' : ''}`}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-slate-800 focus:bg-slate-800 focus:outline-hidden"
                    onClick={() => onToggleValue(item.value)}
                  >
                    <input type="checkbox" readOnly checked={checked} tabIndex={-1} className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{item.value}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400">{item.count.toLocaleString()}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`Show only ${item.value}`}
                    className="invisible shrink-0 rounded-sm border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200 hover:bg-slate-700 focus:visible group-hover:visible"
                    onClick={() => onOnlyValue(item.value)}
                  >
                    Only
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </MenuSection>
    </GridMenu>
  );
};
