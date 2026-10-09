import { useRef, useState } from 'react';

import { GridMenu, MenuItem, MenuSection } from '@components/grid/GridMenu';
import type { CsvExportFormat } from '@utils/csvExport';

interface ExportMenuProps {
  disabled: boolean;
  busy: boolean;
  canExportView: boolean;
  canExportLabelled: boolean;
  canExportGrouping: boolean;
  onExportRows: (scope: 'view' | 'labelled', format: CsvExportFormat) => void;
  onExportGrouping: (format: CsvExportFormat) => void;
  onExportAnnotations: () => void;
}

const compressionSupported = typeof CompressionStream === 'function';

export const ExportMenu = ({
  disabled,
  busy,
  canExportView,
  canExportLabelled,
  canExportGrouping,
  onExportRows,
  onExportGrouping,
  onExportAnnotations
}: ExportMenuProps): JSX.Element => {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = () => setAnchor(null);
  const choose = (action: () => void) => () => {
    close();
    action();
  };

  const formats = (enabled: boolean, run: (format: CsvExportFormat) => void) => (
    <>
      <MenuItem disabled={!enabled || busy} onClick={choose(() => run('csv'))}>
        .csv
      </MenuItem>
      <MenuItem disabled={!enabled || busy || !compressionSupported} onClick={choose(() => run('csv.gz'))}>
        .csv.gz
      </MenuItem>
    </>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={anchor != null}
        onClick={() => {
          const rect = buttonRef.current!.getBoundingClientRect();
          setAnchor(anchor ? null : { x: Math.max(0, rect.right - 256), y: rect.bottom + 4 });
        }}
      >
        {busy ? 'Exporting…' : 'Export ▾'}
      </button>
      {anchor ? (
        <GridMenu label="Export" x={anchor.x} y={anchor.y} onClose={close} className="w-64">
          <MenuSection title="Rows in current view">{formats(canExportView, (format) => onExportRows('view', format))}</MenuSection>
          <MenuSection title="Labelled rows only">
            {formats(canExportLabelled, (format) => onExportRows('labelled', format))}
          </MenuSection>
          <MenuSection title="Grouping">{formats(canExportGrouping, onExportGrouping)}</MenuSection>
          <MenuSection title="Annotations">
            <MenuItem onClick={choose(onExportAnnotations)}>Labels &amp; notes (.json)</MenuItem>
          </MenuSection>
        </GridMenu>
      ) : null}
    </>
  );
};
