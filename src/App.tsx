import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { proxy } from 'comlink';

import { useAppStore } from '@state/appStore';
import { useDataStore, type GridRow } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';
import { useTagStore } from '@state/tagStore';
import DataGrid from '@components/DataGrid';
import FilterBuilder from '@components/filter/FilterBuilder';
import { FuzzyBanner } from '@components/FuzzyBanner';
import PivotView from '@components/PivotView';
import ColumnsPanel from '@components/ColumnsPanel';
import LabelsPanel from '@components/LabelsPanel';
import OptionsPanel from '@components/options/OptionsPanel';
import TagNoteDialog from '@components/tagging/TagNoteDialog';
import { getDataWorker } from '@workers/dataWorkerProxy';
import { buildFilterExpression } from '@utils/filterExpression';
import { logDebug } from '@utils/debugLog';
import { getFontStack } from '@constants/fonts';
import { summariseLabelFilters } from '@utils/labelFilters';
import { serializeToCsv, generateExportFilename } from '@utils/csvExport';

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
  const initializeColumnLayout = useSessionStore((state) => state.initializeColumnLayout);
  const startLoading = useDataStore((state) => state.startLoading);
  const setHeader = useDataStore((state) => state.setHeader);
  const reportProgress = useDataStore((state) => state.reportProgress);
  const complete = useDataStore((state) => state.complete);
  const setError = useDataStore((state) => state.setError);
  const setSearchResult = useDataStore((state) => state.setSearchResult);
  const clearSearchResult = useDataStore((state) => state.clearSearchResult);
  const loaderStatus = useDataStore((state) => state.status);
  const loaderMessage = useDataStore((state) => state.message);
  const matchedRows = useDataStore((state) => state.matchedRows);
  const totalRows = useDataStore((state) => state.totalRows);
  const stats = useDataStore((state) => state.stats);
  const columns = useDataStore((state) => state.columns);
  const columnKeys = useDataStore((state) => state.columns.map((column) => column.key));
  const allColumns = useDataStore((state) => state.columns);
  const tagLabels = useTagStore((state) => state.labels);
  const tagRecords = useTagStore((state) => state.tags);
  const applyTagToRows = useTagStore((state) => state.applyTag);
  const exportTags = useTagStore((state) => state.exportTags);
  const [searchTerm, setSearchTerm] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [showPivot, setShowPivot] = useState(false);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [noteEditor, setNoteEditor] = useState<{
    rowId: number;
    labelId: string | null;
    note: string;
  } | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    // Prevent back button navigation to avoid triggering on horizontal scroll/swipe
    history.pushState(null, '', location.href);
    const handlePopState = () => {
      history.pushState(null, '', location.href);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

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
        await worker.init({
          debugLogging: import.meta.env.DEV,
          slowBatchThresholdMs: 50
        });
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

      if (import.meta.env.DEV) {
        console.info('[app] Triggering loadFile for handle', {
          name: fileHandle.name
        });
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
              if (import.meta.env.DEV) {
                logDebug('app', 'Worker onStart', { columnCount: columns.length, columns });
              }
              if (!cancelled) {
                setHeader(columns);
              }
            },
            onProgress: async (progress) => {
              if (import.meta.env.DEV) {
                logDebug('app', 'Worker onProgress', { ...progress });
              }
              if (!cancelled) {
                reportProgress(progress);
              }
            },
            onComplete: async (summary) => {
              if (import.meta.env.DEV) {
                console.info('[app] Worker onComplete', summary);
              }
              if (!cancelled) {
                complete(summary);
                // Initialize column layout: hide columns that are entirely null/empty
                const columnKeys = Object.keys(summary.columnTypes);
                initializeColumnLayout(columnKeys, summary.columnInference, summary.rowsParsed);
                // Load tags to populate DataGrid tag column
                void useTagStore.getState().load();
              }
            },
            onError: async (error) => {
              if (import.meta.env.DEV) {
                console.error('[app] Worker onError', error);
              }
              if (!cancelled) {
                setError(error.message ?? 'Failed to load file');
              }
            }
          })
        );
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('[app] loadFile threw', error);
        }
        if (!cancelled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void loadFile();

    return () => {
      cancelled = true;
    };
  }, [complete, fileHandle, reportProgress, setError, setHeader, startLoading]);

  useEffect(() => {
    useTagStore.getState().reset();
    setNoteEditor(null);
    setNoteSaving(false);
  }, [fileHandle]);

  const filterExpression = useMemo(() => buildFilterExpression(filters), [filters]);

  const labelFilterSummary = useMemo(
    () => summariseLabelFilters(filters, tagLabels),
    [filters, tagLabels]
  );

  const statusText = useMemo(() => {
    let base: string;
    if (matchedRows != null && totalRows > 0) {
      base = `Showing ${matchedRows.toLocaleString()} of ${totalRows.toLocaleString()} rows`;
    } else if (loaderMessage) {
      base = loaderMessage;
    } else if (loaderStatus === 'loading') {
      base = stats
        ? `Streaming… parsed ${stats.rowsParsed.toLocaleString()} rows (${formatBytes(stats.bytesParsed)})`
        : 'Streaming CSV/TSV ingestion…';
    } else {
      base = 'Ready for streaming CSV/TSV ingestion.';
    }

    if (labelFilterSummary) {
      return `${base} • ${labelFilterSummary.summary}`;
    }

    return base;
  }, [matchedRows, totalRows, loaderMessage, loaderStatus, stats, labelFilterSummary]);

  const openNoteEditor = useCallback(
    ({ rowId }: { rowId: number }) => {
      const record = tagRecords[rowId] ?? null;
      setNoteEditor({
        rowId,
        labelId: record?.labelId ?? null,
        note: record?.note ?? ''
      });
    },
    [tagRecords]
  );

  const submitNote = useCallback(
    async (noteValue: string) => {
      if (!noteEditor) {
        return;
      }

      setNoteSaving(true);
      try {
        await applyTagToRows({
          rowIds: [noteEditor.rowId],
          labelId: noteEditor.labelId,
          note: noteValue
        });
        setNoteEditor(null);
      } catch (error) {
        console.error('Failed to update note', error);
      } finally {
        setNoteSaving(false);
      }
    },
    [applyTagToRows, noteEditor]
  );

  const handleSaveNote = useCallback(
    (note: string, labelId: string | null) => {
      if (noteEditor) {
        void applyTagToRows({ rowIds: [noteEditor.rowId], labelId, note });
      }
      setNoteEditor(null);
      setNoteSaving(false);
    },
    [applyTagToRows, noteEditor]
  );

  const handleClearNote = useCallback(
    (labelId: string | null) => {
      if (noteEditor) {
        void applyTagToRows({ rowIds: [noteEditor.rowId], labelId, note: '' });
      }
      setNoteEditor(null);
    },
    [applyTagToRows, noteEditor]
  );

  const noteEditorLabel = useMemo(() => {
    if (!noteEditor) {
      return undefined;
    }

    if (noteEditor.labelId == null) {
      return {
        name: 'No label',
        color: undefined
      };
    }

    const match = tagLabels.find((label) => label.id === noteEditor.labelId);
    if (!match) {
      return {
        name: `Unknown label (${noteEditor.labelId})`,
        color: undefined
      };
    }

    return {
      name: match.name,
      color: match.color
    };
  }, [noteEditor, tagLabels]);

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
          columns: columnKeys,
          filter: filterExpression,
          limit: 500,
          caseSensitive: searchCaseSensitive
        });
        const fetchedRows = await worker.fetchRowsByIds(response.rows);
        setSearchResult({
          rows: fetchedRows,
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
              'text/tab-separated-values': ['.tsv'],
              'application/gzip': ['.csv.gz', '.tsv.gz']
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

  const handleExportCsv = useCallback(async () => {
    if (!fileHandle || matchedRows === null || matchedRows === 0) {
      return;
    }

    try {
      const worker = getDataWorker();
      const allRows: GridRow[] = [];
      let offset = 0;
      const chunkSize = 10000;

      while (offset < matchedRows) {
        const limit = Math.min(chunkSize, matchedRows - offset);
        const result = await worker.fetchRows({ offset, limit });
        allRows.push(...result.rows);
        offset += limit;
      }

      // Prepare CSV data
      const headers = allColumns.map(col => col.headerName);
      const csvRows = allRows.map(row =>
        allColumns.map(col => (row[col.key] as string) ?? '')
      );

      // Serialize to CSV
      const csvContent = serializeToCsv(headers, csvRows);

      // Generate filename
      const filename = generateExportFilename(fileHandle.name);

      // Download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export CSV', error);
      setError('Failed to export CSV');
    }
  }, [fileHandle, matchedRows, allColumns, setError]);

  const handleExportTags = useCallback(async () => {
    try {
      const response = await exportTags();
      if (response) {
        const json = JSON.stringify(response, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tags-${fileHandle?.name ?? 'export'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Failed to export tags', error);
      setError('Failed to export tags');
    }
  }, [exportTags, fileHandle, setError]);

  return (
    <div className="flex h-full flex-col bg-canvas text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Tabular Analysis Workbench</h1>
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
            onClick={() => setColumnsOpen(true)}
            disabled={!workerReady}
          >
            Columns
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
            onClick={() => setLabelsOpen(true)}
            disabled={!workerReady}
          >
            Labels
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
            onClick={handleExportCsv}
            disabled={!workerReady || !fileHandle || matchedRows === null || matchedRows === 0}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
            onClick={handleExportTags}
            disabled={!workerReady || !fileHandle}
          >
            Export Tags
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
            onClick={() => setShowPivot((value) => !value)}
            disabled={!workerReady || loaderStatus === 'loading'}
          >
            {showPivot ? 'Show Grid' : 'Pivot View'}
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
        <aside
          className={`hidden border-r border-slate-800 lg:block ${
            isSidebarCollapsed ? 'w-6' : 'w-72'
          }`}
        >
          <div className="flex h-full flex-col">
            <button
              type="button"
              className={`flex items-center justify-center border-b border-slate-800 text-xs text-slate-300 hover:bg-slate-900 ${
                isSidebarCollapsed ? 'px-0 py-2' : 'px-2 py-2'
              }`}
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={isSidebarCollapsed ? 'Expand filters panel' : 'Collapse filters panel'}
            >
              {isSidebarCollapsed ? '»' : '«'}
            </button>
            <div
              className={`flex-1 overflow-auto ${
                isSidebarCollapsed ? 'hidden' : 'p-4'
              }`}
            >
              {!isSidebarCollapsed && <FilterBuilder columns={columns} />}
            </div>
          </div>
        </aside>
        <section className="flex flex-1 flex-col">
          <div className="flex-1 overflow-auto p-4">
          <FuzzyBanner />
          <div className="h-full rounded border border-slate-800">
          {showPivot ? (
            <PivotView />
          ) : (
            <DataGrid status={loaderStatus} onEditTagNote={openNoteEditor} />
            )}
            </div>
          </div>
          <footer className="border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
            {statusText}
          </footer>
        </section>
      </main>
      <OptionsPanel open={optionsOpen} onClose={() => setOptionsOpen(false)} />
      <LabelsPanel open={labelsOpen} onClose={() => setLabelsOpen(false)} />
      <ColumnsPanel open={columnsOpen} onClose={() => setColumnsOpen(false)} />
      <TagNoteDialog
        open={noteEditor != null}
        initialLabelId={noteEditor?.labelId ?? null}
        initialNote={noteEditor?.note ?? ''}
        onSave={handleSaveNote}
        onClear={handleClearNote}
        onClose={() => {
          if (!noteSaving) {
            setNoteEditor(null);
          }
        }}
        saving={noteSaving}
      />
    </div>
  );
};

export default App;
