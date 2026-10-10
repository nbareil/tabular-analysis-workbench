import { type JSX, useEffect, useState } from 'react';

import { useDataStore } from '@state/dataStore';
import { formatBytes } from '@utils/formatBytes';

interface StatusBarProps {
  labelFilterSummary: string | null;
  fileSize: number | null;
}

const useStorageUsage = (refreshKey: unknown): number | null => {
  const [usage, setUsage] = useState<number | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((estimate) => setUsage(estimate.usage ?? null));
  }, [refreshKey]);
  return usage;
};

/** Footer with row counts, active view scopes, load progress and storage use. */
export const StatusBar = ({ labelFilterSummary, fileSize }: StatusBarProps): JSX.Element => {
  const status = useDataStore((state) => state.status);
  const message = useDataStore((state) => state.message);
  const stats = useDataStore((state) => state.stats);
  const totalRows = useDataStore((state) => state.totalRows);
  const matchedRows = useDataStore((state) => state.matchedRows);
  const filterActive = useDataStore((state) => state.filterActive);
  const searchActive = useDataStore((state) => state.searchActive);
  const storageUsage = useStorageUsage(status);

  const segments: string[] = [];
  if (status === 'loading' && stats) {
    const progress = fileSize ? ` · ${Math.min(100, Math.round((stats.bytesParsed / fileSize) * 100))}%` : '';
    segments.push(`Streaming… ${stats.rowsParsed.toLocaleString()} rows (${formatBytes(stats.bytesParsed)})${progress}`);
  } else if (totalRows > 0) {
    segments.push(`Showing ${(matchedRows ?? totalRows).toLocaleString()} of ${totalRows.toLocaleString()} rows`);
  } else {
    segments.push(message ?? 'Open a CSV, TSV or JSON Lines file to begin.');
  }
  const scopes = [filterActive ? 'filtered' : null, searchActive ? 'search' : null].filter(Boolean);
  if (scopes.length) {
    segments.push(scopes.join(' + '));
  }
  if (labelFilterSummary) {
    segments.push(labelFilterSummary);
  }
  if (status === 'ready' && stats?.malformedRows) {
    segments.push(`${stats.malformedRows.toLocaleString()} malformed rows`);
  }
  if (status === 'error' && message) {
    segments.push(message);
  }
  if (storageUsage != null) {
    segments.push(`Browser storage ${formatBytes(storageUsage)}`);
  }

  return (
    <footer className="border-t border-slate-800 px-4 py-2 text-xs text-slate-400" aria-live="polite">
      {segments.join(' • ')}
    </footer>
  );
};
