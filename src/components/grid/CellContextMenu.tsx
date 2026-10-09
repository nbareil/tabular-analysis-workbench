import type { LabelDefinition, TagRecord } from '@workers/types';
import { GridMenu, MenuItem, MenuSection } from './GridMenu';
import type { CellContextMenuState, FilterMenuMetadata } from './gridUtils';

interface CellContextMenuProps {
  menu: CellContextMenuState;
  metadata: FilterMenuMetadata;
  isLabelColumn: boolean;
  isDatetimeColumn: boolean;
  labels: LabelDefinition[];
  activeRecord: TagRecord | undefined;
  /** Number of rows a label change applies to (the selection plus the clicked row). */
  targetRowCount: number;
  tagBusy: boolean;
  canCopy: boolean;
  onCopyRows: () => void;
  onCopyCell: () => void;
  onFilterIn: () => void;
  onFilterOut: () => void;
  onFilterTimeWindow: () => void;
  onApplyLabel: (labelId: string | null) => void;
  onEditNote: (() => void) | null;
  onHideColumn: () => void;
  onClose: () => void;
}

export const CellContextMenu = ({
  menu,
  metadata,
  isLabelColumn,
  isDatetimeColumn,
  labels,
  activeRecord,
  targetRowCount,
  tagBusy,
  canCopy,
  onCopyRows,
  onCopyCell,
  onFilterIn,
  onFilterOut,
  onFilterTimeWindow,
  onApplyLabel,
  onEditNote,
  onHideColumn,
  onClose
}: CellContextMenuProps): JSX.Element => {
  const activeLabelIds = activeRecord?.labelIds ?? [];
  const hasTagOrNote = activeLabelIds.length > 0 || Boolean(activeRecord?.note);

  return (
    <GridMenu label="Cell actions" x={menu.x} y={menu.y} onClose={onClose} className="min-w-[14rem]">
      <MenuSection title="Copy">
        <MenuItem onClick={onCopyRows} disabled={!canCopy}>
          {targetRowCount > 1 ? `Copy ${targetRowCount} rows` : 'Copy row'}
        </MenuItem>
        <MenuItem onClick={onCopyCell} disabled={!canCopy || !menu.cellClipboardText}>
          Copy cell value
        </MenuItem>
      </MenuSection>
      <MenuSection title="Filters">
        <MenuItem onClick={onFilterIn} disabled={metadata.eqMatchesValue}>
          Filter in <span className="truncate text-slate-400">{menu.displayValue}</span>
        </MenuItem>
        <MenuItem onClick={onFilterOut} disabled={metadata.neqExists}>
          Filter out <span className="truncate text-slate-400">{menu.displayValue}</span>
        </MenuItem>
        {isDatetimeColumn ? <MenuItem onClick={onFilterTimeWindow}>Filter time window around this value…</MenuItem> : null}
      </MenuSection>
      {isLabelColumn ? (
        <MenuSection title="Labels">
          {targetRowCount > 1 ? (
            <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-emerald-500">
              Applies to {targetRowCount} rows
            </div>
          ) : null}
          {labels.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-slate-400">No labels yet. Use the Labels panel.</div>
          ) : null}
          {labels.map((label) => (
            <MenuItem
              key={label.id}
              disabled={tagBusy}
              className={activeLabelIds.includes(label.id) ? 'bg-slate-800/60' : ''}
              onClick={() => onApplyLabel(label.id)}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} aria-hidden />
              <span className="truncate">{label.name}</span>
            </MenuItem>
          ))}
          {onEditNote ? <MenuItem onClick={onEditNote}>Edit note…</MenuItem> : null}
          {hasTagOrNote ? (
            <MenuItem disabled={tagBusy} onClick={() => onApplyLabel(null)}>
              Clear labels &amp; notes
            </MenuItem>
          ) : null}
        </MenuSection>
      ) : (
        <MenuSection title="Column">
          <MenuItem onClick={onHideColumn}>Hide column</MenuItem>
        </MenuSection>
      )}
    </GridMenu>
  );
};
