import { type JSX, useCallback, useEffect, useState } from 'react';

import { useAppStore } from '@state/appStore';
import { useDataStore } from '@state/dataStore';
import { getDataWorker, type TimeHistogramResult } from '@workers/dataWorkerProxy';
import { formatUtcIso } from '@workers/valueParsing';
import { reportAppError } from '@utils/diagnostics';

const BUCKETS = 80;
// Single-series bar colour validated (3:1 contrast, chroma floor) against each theme's surface.
const BAR_COLOR = { light: '#2a78d6', dark: '#3987e5' } as const;

interface TimelinePanelProps {
  column: string;
  onSelectRange: (start: number, end: number) => void;
  onClose: () => void;
}

const formatBucket = (start: number, bucketMs: number): string =>
  `${formatUtcIso(start)} – ${formatUtcIso(start + bucketMs)}`;

/**
 * Row density over time for one datetime column of the current view. Hovering a bar shows its
 * count; clicking or dragging across bars filters the view to that time range.
 */
export const TimelinePanel = ({ column, onSelectRange, onClose }: TimelinePanelProps): JSX.Element => {
  const theme = useAppStore((state) => state.theme);
  const viewVersion = useDataStore((state) => state.viewVersion);
  const [histogram, setHistogram] = useState<TimeHistogramResult | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDataWorker()
      .getTimeHistogram({ column, buckets: BUCKETS })
      .then((result) => {
        if (!cancelled) {
          setHistogram(result);
        }
      })
      .catch((error) => reportAppError('Failed to build timeline', error, { operation: 'grid.timeline' }));
    return () => {
      cancelled = true;
    };
  }, [column, viewVersion]);

  const counts = histogram?.counts ?? [];
  const peak = Math.max(1, ...counts);
  const start = histogram?.start ?? 0;
  const bucketMs = histogram?.bucketMs ?? 0;
  const inDrag = (index: number) =>
    drag != null && index >= Math.min(drag.from, drag.to) && index <= Math.max(drag.from, drag.to);

  const commit = useCallback(
    (from: number, to: number) => {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      onSelectRange(start + low * bucketMs, start + (high + 1) * bucketMs - 1);
    },
    [bucketMs, onSelectRange, start]
  );

  // A drag may end anywhere on the page; releasing outside the bars still commits the range.
  useEffect(() => {
    if (!drag) {
      return undefined;
    }
    const finish = () => {
      commit(drag.from, drag.to);
      setDrag(null);
    };
    window.addEventListener('mouseup', finish);
    return () => window.removeEventListener('mouseup', finish);
  }, [commit, drag]);

  const caption =
    hovered != null
      ? `${formatBucket(start + hovered * bucketMs, bucketMs)} · ${counts[hovered]!.toLocaleString()} rows`
      : histogram?.start != null
        ? `${histogram.datedRows.toLocaleString()} dated rows · click or drag to filter`
        : 'No parseable timestamps in the current view';

  return (
    <section aria-label={`Timeline of ${column}`} className="mb-2 rounded border border-slate-800 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-300">Timeline · {column}</h3>
        <span className="truncate text-slate-400" aria-live="polite">
          {caption}
        </span>
        <button type="button" className="rounded px-2 text-slate-400 hover:text-slate-100" aria-label="Close timeline" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="flex items-start gap-2">
        <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-slate-500">{peak.toLocaleString()}</span>
        <div className="flex h-16 flex-1 items-end gap-[2px] border-b border-slate-700">
          {counts.map((count, index) => (
            <button
              key={index}
              type="button"
              aria-label={`${formatBucket(start + index * bucketMs, bucketMs)}: ${count.toLocaleString()} rows`}
              className="flex h-full max-w-[24px] flex-1 items-end focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-300"
              onMouseLeave={() => setHovered(null)}
              onMouseEnter={() => {
                setHovered(index);
                setDrag((current) => (current ? { ...current, to: index } : current));
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                setDrag({ from: index, to: index });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  commit(index, index);
                }
              }}
              onFocus={() => setHovered(index)}
            >
              <span
                className="block w-full rounded-t-[4px]"
                style={{
                  height: count > 0 ? `${Math.max(2, (count / peak) * 100)}%` : 0,
                  backgroundColor: BAR_COLOR[theme],
                  opacity: hovered === index || inDrag(index) || (hovered == null && drag == null) ? 1 : 0.55
                }}
              />
            </button>
          ))}
        </div>
      </div>
      {histogram?.start != null ? (
        <div className="ml-12 mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
          <span>{formatUtcIso(start)}</span>
          <span>{formatUtcIso(start + counts.length * bucketMs)}</span>
        </div>
      ) : null}
      <details className="ml-12 mt-1 text-[11px] text-slate-400">
        <summary className="cursor-pointer">Table view</summary>
        <table className="mt-1 w-full tabular-nums">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="font-normal">Bucket (UTC)</th>
              <th className="text-right font-normal">Rows</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((count, index) => (
              <tr key={index}>
                <td>{formatBucket(start + index * bucketMs, bucketMs)}</td>
                <td className="text-right">{count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
};
