import { useEffect, useMemo, useState } from 'react';

import { Modal } from '@components/Modal';
import { availableTimeZones } from '@utils/datetimeFormat';

import {
  FONT_OPTIONS,
  clampFontSize,
  getFontOption,
  getFontStack
} from '@constants/fonts';
import { useAppStore } from '@state/appStore';

interface OptionsPanelProps {
  open: boolean;
  onClose: () => void;
  onFlushStoredData: () => Promise<void>;
}

const OptionsPanel = ({
  open,
  onClose,
  onFlushStoredData
}: OptionsPanelProps): JSX.Element | null => {
  const interfaceFontFamily = useAppStore((state) => state.interfaceFontFamily);
  const interfaceFontSize = useAppStore((state) => state.interfaceFontSize);
  const dataFontFamily = useAppStore((state) => state.dataFontFamily);
  const dataFontSize = useAppStore((state) => state.dataFontSize);
  const setInterfaceFontFamily = useAppStore((state) => state.setInterfaceFontFamily);
  const setInterfaceFontSize = useAppStore((state) => state.setInterfaceFontSize);
  const setDataFontFamily = useAppStore((state) => state.setDataFontFamily);
  const setDataFontSize = useAppStore((state) => state.setDataFontSize);
  const [flushState, setFlushState] = useState<'idle' | 'pending' | 'done'>('idle');
  const [flushError, setFlushError] = useState<string | null>(null);
  const displayTimeZone = useAppStore((state) => state.displayTimeZone);
  const setDisplayTimeZone = useAppStore((state) => state.setDisplayTimeZone);
  const timeZones = useMemo(() => availableTimeZones(), []);

  useEffect(() => {
    if (open) {
      setFlushState('idle');
      setFlushError(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleInterfaceFontChange = (value: string) => {
    setInterfaceFontFamily(value);
  };

  const handleInterfaceFontSizeChange = (value: string) => {
    const parsed = Number.parseFloat(value);
    setInterfaceFontSize(clampFontSize(Number.isFinite(parsed) ? parsed : NaN));
  };

  const handleDataFontChange = (value: string) => {
    setDataFontFamily(value);
  };

  const handleDataFontSizeChange = (value: string) => {
    const parsed = Number.parseFloat(value);
    setDataFontSize(clampFontSize(Number.isFinite(parsed) ? parsed : NaN));
  };

  const handleFlushStoredData = async () => {
    if (flushState === 'pending') {
      return;
    }

    setFlushError(null);
    setFlushState('pending');

    try {
      await onFlushStoredData();
      setFlushState('done');
    } catch (error) {
      setFlushError(error instanceof Error ? error.message : 'Failed to delete stored data.');
      setFlushState('idle');
    }
  };

  const activeInterfaceFont = getFontOption(interfaceFontFamily);
  const activeDataFont = getFontOption(dataFontFamily);

  return (
    <Modal title="Options" onClose={onClose}>
        <p className="mb-4 text-xs text-slate-400">Preferences are saved in this browser and apply to every file.</p>
        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Interface typography
            </h3>
            <label className="flex flex-col gap-2">
              <span className="text-xs text-slate-400">Interface font</span>
              <select
                className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                value={interfaceFontFamily}
                onChange={(event) => handleInterfaceFontChange(event.target.value)}
              >
                {FONT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {activeInterfaceFont.description && (
                <p className="text-xs text-slate-500">{activeInterfaceFont.description}</p>
              )}
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-40">Font size (interface)</span>
              <input
                type="number"
                min={10}
                max={24}
                value={interfaceFontSize}
                onChange={(event) => handleInterfaceFontSizeChange(event.target.value)}
                className="w-20 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-200"
              />
              <span className="text-slate-500">px</span>
            </label>
            <div className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300">
              <span
                style={{
                  fontFamily: getFontStack(interfaceFontFamily),
                  fontSize: `${interfaceFontSize}px`
                }}
              >
                Quick brown fox — 0123456789
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-800 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Data grid typography
            </h3>
            <label className="flex flex-col gap-2">
              <span className="text-xs text-slate-400">Data font</span>
              <select
                className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                value={dataFontFamily}
                onChange={(event) => handleDataFontChange(event.target.value)}
              >
                {FONT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {activeDataFont.description && (
                <p className="text-xs text-slate-500">{activeDataFont.description}</p>
              )}
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-40">Font size (data)</span>
              <input
                type="number"
                min={10}
                max={24}
                value={dataFontSize}
                onChange={(event) => handleDataFontSizeChange(event.target.value)}
                className="w-20 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-200"
              />
              <span className="text-slate-500">px</span>
            </label>
            <div className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300">
              <span
                style={{
                  fontFamily: getFontStack(dataFontFamily),
                  fontSize: `${dataFontSize}px`
                }}
              >
                sample_value,2024-01-01T00:00:00Z,42
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-800 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Timestamps</h3>
            <label className="flex flex-col gap-2">
              <span className="text-xs text-slate-400">Display time zone</span>
              <select
                className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                value={displayTimeZone}
                onChange={(event) => setDisplayTimeZone(event.target.value)}
              >
                <option value="original">As written in the file</option>
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                Converts datetime columns for display only. Timestamps without a zone are read as UTC.
              </p>
            </label>
          </div>

          <div className="flex flex-col gap-3 border-t border-rose-900/60 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-300">
              Delete stored data
            </h3>
            <p className="text-xs text-slate-400">
              Removes cached rows, all saved labels and notes, and these preferences from this browser,
              then reloads. Your files are not touched.
            </p>
            <div className="flex items-center justify-between gap-3 rounded border border-rose-900/60 bg-rose-950/20 px-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-rose-100">Delete everything</p>
                <p className="text-xs text-rose-200/80">Export labels first if you want to keep them.</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded border border-rose-600 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleFlushStoredData}
                disabled={flushState === 'pending' || flushState === 'done'}
              >
                {flushState === 'pending' ? 'Deleting…' : flushState === 'done' ? 'Reloading…' : 'Delete'}
              </button>
            </div>
            {flushState === 'pending' && (
              <p className="text-xs text-slate-500">
                Clearing stored browser data and restarting the workspace…
              </p>
            )}
            {flushError && <p className="text-xs text-rose-300">{flushError}</p>}
          </div>
        </section>
    </Modal>
  );
};

export default OptionsPanel;
