import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { proxy } from 'comlink';

import { useAppStore } from '@state/appStore';
import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';
import DataGrid from '@components/DataGrid';
import FilterBuilder from '@components/filter/FilterBuilder';
import OptionsPanel from '@components/options/OptionsPanel';
import { getDataWorker } from '@workers/dataWorkerProxy';
import type { RowBatch } from '@workers/types';
import { buildFilterExpression } from '@utils/filterExpression';
import { getFontStack } from '@constants/fonts';

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const App = (): JSX.Element => {
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const [workerReady, setWorkerReady] = useState(false);
  const fileHandle = useSessionStore((state) => state.fileHandle);
  const filters = useSessionStore((state) => state.filters);
  const searchCaseSensitive = useSessionStore((state) => state.searchCaseSensitive);
  const setSearchCaseSensitive = useSessionStore((state) => state.setSearchCaseSensitive);
  const interfaceFontFamily = useSessionStore((state) => state.interfaceFontFamily);
  const interfaceFontSize = useSessionStore((state) => state.interfaceFontSize);
  const dataFontFamily = useSessionStore((state) => state.dataFontFamily);
  const dataFontSize = useSessionStore((state) => state.dataFontSize);
  const setFileHandle = useSessionStore((state) => state.setFileHandle);
  const startLoading = useDataStore((state) => state.startLoading);
  const setHeader = useDataStore((state) => state.setHeader);
  const appendBatch = useDataStore((state) => state.appendBatch);
  const complete = useDataStore((state) => state.complete);
  const setError = useDataStore((state) => state.setError);
  const setSearchResult = useDataStore((state) => state.setSearchResult);
  const clearSearchResult = useDataStore((state) => state.clearSearchResult);
  const loaderStatus = useDataStore((state) => state.status);
  const loaderMessage = useDataStore((state) => state.message);
  const matchedRows = useDataStore((state) => state.matchedRows);
  const totalRows = useDataStore((state) => state.totalRows);
  const stats = useDataStore((state) => state.stats);
  const columns = useDataStore((state) => state.columns.map((column) => column.key));
  const [searchTerm, setSearchTerm] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const fontStack = getFontStack(interfaceFontFamily);
    document.documentElement.style.setProperty('--app-font-family', fontStack);
    document.documentElement.style.setProperty('--app-font-size', `${interfaceFontSize}px`);
  }, [interfaceFontFamily, interfaceFontSize]);

  useEffect(() => {
    const fontStack = getFontStack(dataFontFamily);
    document.documentElement.style.setProperty('--data-font-family', fontStack);
    document.documentElement.style.setProperty('--data-font-size', `${dataFontSize}px`);
  }, [dataFontFamily, dataFontSize]);

  useEffect(() => {
    let cancelled = false;

    const initWorker = async () => {
      try {
        const worker = getDataWorker();
        await worker.init({});
        const response = await worker.ping();

        if (!cancelled && response === 'pong') {
          setWorkerReady(true);
        }
      } catch (error) {
        console.error('Failed to initialize data worker', error);
      }
    };

    initWorker();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadFile = async () => {
      if (!fileHandle) {
        return;
      }

      setSearchTerm('');
      clearSearchResult();

      startLoading(fileHandle.name ?? 'Unknown file');

      try {
        const worker = getDataWorker();
        await worker.loadFile(
          { handle: fileHandle },
          proxy({
            onStart: async ({ columns }) => {
              if (!cancelled) {
                setHeader(columns);
              }
            },
            onBatch: async (batch: RowBatch) => {
              if (!cancelled) {
                appendBatch(batch);
              }
            },
            onComplete: async (summary) => {
              if (!cancelled) {
                complete(summary);
              }
            },
            onError: async (error) => {
              if (!cancelled) {
                setError(error.message ?? 'Failed to load file');
              }
            }
          })
        );
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void loadFile();

    return () => {
      cancelled = true;
    };
  }, [appendBatch, complete, fileHandle, setError, setHeader, startLoading]);

  const filterExpression = useMemo(() => buildFilterExpression(filters), [filters]);

  const statusText = useMemo(() => {
    if (matchedRows != null && totalRows > 0) {
      return `Showing ${matchedRows.toLocaleString()} of ${totalRows.toLocaleString()} rows`;
    }

    if (loaderMessage) {
      return loaderMessage;
    }

    if (loaderStatus === 'loading') {
      if (stats) {
        return `Streaming… parsed ${stats.rowsParsed.toLocaleString()} rows (${formatBytes(stats.bytesParsed)})`;
      }

      return 'Streaming CSV/TSV ingestion…';
    }

    return 'Ready for streaming CSV/TSV ingestion.';
  }, [matchedRows, totalRows, loaderMessage, loaderStatus, stats]);

  useEffect(() => {
    if (!workerReady) {
      return undefined;
    }

    const trimmed = searchTerm.trim();
    const timeout = window.setTimeout(async () => {
      if (!workerReady) {
        return;
      }

      if (!trimmed) {
        clearSearchResult();
        return;
      }

      if (!columns.length) {
        return;
      }

      try {
        const worker = getDataWorker();
        const response = await worker.globalSearch({
          query: trimmed,
          columns,
          filter: filterExpression,
          limit: 500,
          caseSensitive: searchCaseSensitive
        });
        setSearchResult({
          rows: response.rows,
          totalRows: response.totalRows,
          matchedRows: response.matchedRows
        });
      } catch (error) {
        console.error('Failed to perform global search', error);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    searchTerm,
    workerReady,
    columns,
    filterExpression,
    setSearchResult,
    clearSearchResult,
    searchCaseSensitive
  ]);

  const handleOpenFile = useCallback(async () => {
    if (!('showOpenFilePicker' in window)) {
      setError('File System Access API is not supported in this browser.');
      return;
    }

    try {
      const openFilePicker = window.showOpenFilePicker;
      if (!openFilePicker) {
        setError('File picker unavailable.');
        return;
      }

      const [handle] = await openFilePicker({
        types: [
          {
            description: 'Delimited text',
            accept: {
              'text/csv': ['.csv'],
              'text/tab-separated-values': ['.tsv']
            }
          }
        ]
      });

      if (handle) {
        setSearchTerm('');
        clearSearchResult();
        setFileHandle(handle);
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        setError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [setError, setFileHandle]);

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  }, []);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        setSearchTerm('');
        clearSearchResult();
        event.preventDefault();
      }
    },
    [clearSearchResult]
  );

  return (
    <div className="flex h-full flex-col bg-canvas text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Web Timeline Explorer</h1>
          <span className="text-xs uppercase tracking-wide text-slate-400">
            {workerReady ? 'Data worker ready' : 'Initializing worker…'}
          </span>
          {loaderMessage && (
            <span className="text-xs uppercase tracking-wide text-slate-500">
              {loaderMessage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <input
              type="search"
              placeholder="Search visible columns"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200"
              value={searchTerm}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              disabled={!workerReady}
            />
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={searchCaseSensitive}
                onChange={(event) => setSearchCaseSensitive(event.target.checked)}
              />
              Case sensitive
            </label>
          </div>
          <button
            type="button"
            className="rounded bg-accent px-3 py-1 text-sm font-semibold text-slate-900"
            onClick={handleOpenFile}
            disabled={!workerReady || loaderStatus === 'loading'}
          >
            {loaderStatus === 'loading' ? 'Loading…' : 'Open File'}
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
            onClick={() => setOptionsOpen(true)}
          >
            Options
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
            onClick={toggleTheme}
          >
            Toggle Theme
          </button>
        </div>
      </header>
      <main className="flex flex-1 overflow-hidden">
        <aside className="hidden w-72 border-r border-slate-800 p-4 lg:block">
          <FilterBuilder columns={columns} />
        </aside>
        <section className="flex flex-1 flex-col">
          <div className="flex-1 overflow-auto p-4">
            <div className="h-full rounded border border-slate-800">
              <DataGrid status={loaderStatus} />
            </div>
          </div>
          <footer className="border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
            {statusText}
          </footer>
        </section>
      </main>
      <OptionsPanel open={optionsOpen} onClose={() => setOptionsOpen(false)} />
    </div>
  );
};

export default App;
