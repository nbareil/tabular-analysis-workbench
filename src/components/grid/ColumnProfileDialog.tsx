import { type JSX, useEffect, useState } from 'react';

import { Modal } from '@components/Modal';
import { getDataWorker, type ColumnProfile } from '@workers/dataWorkerProxy';

interface ColumnProfileDialogProps {
  column: string;
  onClose: () => void;
}

const percent = (part: number, whole: number): string =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';

/** Summary statistics for one column over the rows in the current view. */
export const ColumnProfileDialog = ({ column, onClose }: ColumnProfileDialogProps): JSX.Element => {
  const [profile, setProfile] = useState<ColumnProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDataWorker()
      .profileColumn(column)
      .then((result) => !cancelled && setProfile(result))
      .catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      cancelled = true;
    };
  }, [column]);

  const rows: Array<[string, string]> = profile
    ? [
        ['Inferred type', profile.type],
        ['Rows in view', profile.rows.toLocaleString()],
        ['Empty', `${profile.emptyCount.toLocaleString()} (${percent(profile.emptyCount, profile.rows)})`],
        ...(profile.type !== 'string'
          ? ([['Not a valid ' + profile.type, `${profile.invalidCount.toLocaleString()} (${percent(profile.invalidCount, profile.rows)})`]] as Array<[string, string]>)
          : []),
        ['Distinct values', `${profile.distinctCapped ? '≥ ' : ''}${profile.distinctCount.toLocaleString()}`],
        ['Minimum', profile.min ?? '—'],
        ['Maximum', profile.max ?? '—'],
        ...(profile.mean != null ? ([['Mean', profile.mean.toLocaleString()]] as Array<[string, string]>) : []),
        ['Text length', `${profile.minLength}–${profile.maxLength} characters`]
      ]
    : [];

  return (
    <Modal title={`Profile · ${column}`} onClose={onClose}>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {!profile && !error ? <p className="text-xs text-slate-400">Profiling…</p> : null}
      {profile ? (
        <div className="space-y-4">
          <table className="w-full text-xs">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label} className="border-b border-slate-800 last:border-0">
                  <th scope="row" className="py-1 pr-4 text-left font-normal text-slate-400">
                    {label}
                  </th>
                  <td className="break-all py-1 font-mono">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {profile.topValues.length ? (
            <table className="w-full text-xs">
              <caption className="mb-1 text-left text-[10px] uppercase tracking-wide text-slate-400">Most common values</caption>
              <tbody>
                {profile.topValues.map((item) => (
                  <tr key={item.value}>
                    <td className="truncate py-0.5 pr-4 font-mono">{item.value}</td>
                    <td className="py-0.5 text-right tabular-nums text-slate-400">{item.count.toLocaleString()}</td>
                    <td className="w-16 py-0.5 text-right tabular-nums text-slate-400">{percent(item.count, profile.rows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
};
