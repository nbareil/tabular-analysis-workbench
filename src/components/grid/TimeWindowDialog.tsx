import { type JSX, useState } from 'react';

import { Modal } from '@components/Modal';
import { formatUtcIso } from '@workers/valueParsing';

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;
type Unit = keyof typeof UNIT_MS;

interface TimeWindowDialogProps {
  column: string;
  center: number;
  onApply: (start: number, end: number) => void;
  onClose: () => void;
}

/** Asks for a ± range around a timestamp and filters the column to that window. */
export const TimeWindowDialog = ({ column, center, onApply, onClose }: TimeWindowDialogProps): JSX.Element => {
  const [amount, setAmount] = useState('5');
  const [unit, setUnit] = useState<Unit>('minutes');
  const span = Number(amount) * UNIT_MS[unit];
  const valid = Number.isFinite(span) && span > 0;

  const apply = () => {
    if (valid) {
      onApply(center - span, center + span);
    }
  };

  return (
    <Modal
      title="Filter time window"
      onClose={onClose}
      widthClassName="max-w-sm"
      footer={
        <>
          <button type="button" className="rounded-sm border border-slate-600 px-3 py-1 text-xs" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-sm bg-accent px-3 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50"
            disabled={!valid}
            onClick={apply}
          >
            Apply filter
          </button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <p className="text-xs text-slate-400">
          Rows where <span className="font-mono text-slate-200">{column}</span> is within the window around{' '}
          <span className="font-mono text-slate-200">{formatUtcIso(center)}</span>.
        </p>
        <div className="flex items-center gap-2">
          <span aria-hidden>±</span>
          <input
            data-autofocus
            aria-label="Window size"
            type="number"
            min="0"
            step="any"
            className="w-24 rounded-sm border border-slate-600 bg-slate-950 px-2 py-1"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <select
            aria-label="Window unit"
            className="rounded-sm border border-slate-600 bg-slate-950 px-2 py-1"
            value={unit}
            onChange={(event) => setUnit(event.target.value as Unit)}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
        {valid ? (
          <p className="text-[11px] text-slate-500">
            {formatUtcIso(center - span)} → {formatUtcIso(center + span)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
};
