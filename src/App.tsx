import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { proxy } from 'comlink';

import { useAppStore } from '@state/appStore';
import { useDataStore, type GridRow } from '@state/dataStore';
import { useSessionStore, getSessionSnapshot } from '@state/sessionStore';
import { useTagStore } from '@state/tagStore';
import DataGrid from '@components/DataGrid';
import FilterBuilder, { buildNewFilter } from '@components/filter/FilterBuilder';
import { FuzzyBanner } from '@components/FuzzyBanner';
import PivotView from '@components/PivotView';
import ColumnsPanel from '@components/ColumnsPanel';
import LabelsPanel from '@components/LabelsPanel';
import OptionsPanel from '@components/options/OptionsPanel';
import TagNotePanel from '@components/tagging/TagNotePanel';
import LargeDatasetWarning from '@components/LargeDatasetWarning';
import CapabilityGate from '@components/CapabilityGate';
import CapabilityWarningBanner from '@components/CapabilityWarningBanner';
import DiagnosticsToast from '@components/DiagnosticsToast';
import { getDataWorker } from '@workers/dataWorkerProxy';
import { buildFilterExpression } from '@utils/filterExpression';
import { logDebug } from '@utils/debugLog';
import { getFontStack } from '@constants/fonts';
import { summariseLabelFilters } from '@utils/labelFilters';
import {
  buildCsvBlob,
  serializeToCsv,
  generateExportFilename,
  type CsvExportFormat
} from '@utils/csvExport';
import { saveBlobFile, saveJsonFile } from '@utils/fileAccess';
import { buildTagExportFilename } from '@utils/tagExport';
import { detectCapabilities, type CapabilityReport } from '@utils/capabilities';
import { useSessionPersistence } from '@/hooks/useSessionPersistence';
import { useFilterSync } from '@/hooks/useFilterSync';
import { formatBytes } from '@utils/formatBytes';
import { reportAppError } from '@utils/diagnostics';
import { useDiagnosticsReporter } from '@/hooks/useDiagnosticsReporter';

const formatTime = (timestamp: number): string => {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp));
};

const formatCellValue = (value: unknown): string => {
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  return String(value);
};

const LARGE_DATASET_WARNING_BYTES = 600 * 1024 * 1024;

interface AppShellProps {
  capabilityReport: CapabilityReport;
  warningsDismissed: boolean;
  onDismissWarnings: () => void;
}

const AppShell = ({
  capabilityReport,
  warningsDismissed,
  onDismissWarnings
}: AppShellProps): JSX.Element => {
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
  const setSearchResult = useDataStore((state) => state.setSearchResult);
  const clearSearchResult = useDataStore((state) => state.clearSearchResult);
  const loaderStatus = useDataStore((state) => state.status);
  const loaderMessage = useDataStore((state) => state.message);
  const errorDetails = useDataStore((state) => state.errorDetails);
  const clearErrorDetails = useDataStore((state) => state.clearError);
  const matchedRows = useDataStore((state) => state.matchedRows);
  const totalRows = useDataStore((state) => state.totalRows);
  const stats = useDataStore((state) => state.stats);
  const columns = useDataStore((state) => state.columns);
  const columnInference = useDataStore((state) => state.columnInference);
  const columnKeys = useDataStore((state) => state.columns.map((column) => column.key));
  const allColumns = useDataStore((state) => state.columns);
  const groupingState = useDataStore((state) => state.grouping);
  const tagLabels = useTagStore((state) => state.labels);
  const tagRecords = useTagStore((state) => state.tags);
  const applyTagToRows = useTagStore((state) => state.applyTag);
  const exportTags = useTagStore((state) => state.exportTags);
  const { applyFilters } = useFilterSync();
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
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const opfsCapability = capabilityReport.checks.find((entry) => entry.id === 'opfs');
  const opfsAvailable = Boolean(opfsCapability?.present);
  const sessionPersistence = useSessionPersistence(opfsAvailable);
  const {
    restoring: persistenceRestoring,
    error: persistenceError,
    lastSavedAt: persistenceLastSavedAt
  } = sessionPersistence;

  useDiagnosticsReporter();

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
    if (!exportMenuOpen || typeof document === 'undefined') {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [exportMenuOpen]);

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

          // Persist tags on page unload
          const handleBeforeUnload = async () => {
            try {
              await worker.persistTags();
            } catch (error) {
              console.warn('Failed to persist tags on unload', error);
            }
          };

          window.addEventListener('beforeunload', handleBeforeUnload);
        }
      } catch (error) {
        reportAppError('Failed to initialize data worker', error, {
          operation: 'worker.init'
        });
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
                reportAppError(error.message ?? 'Failed to load file', error, {
                  operation: 'worker.loadFile',
                  context: { fileName: fileHandle.name }
                });
              }
            }
          })
        );
      } catch (error) {
        if (!cancelled) {
          reportAppError(
            error instanceof Error ? error.message : String(error),
            error,
            {
              operation: 'worker.loadFile',
              context: { fileName: fileHandle.name }
            }
          );
        }
      }
    };

    void loadFile();

    return () => {
      cancelled = true;
    };
  }, [complete, fileHandle, reportProgress, setHeader, startLoading]);

  useEffect(() => {
    useTagStore.getState().reset();
    setNoteEditor(null);
    setNoteSaving(false);
  }, [fileHandle]);

  const addFilterFromShortcut = useCallback((): boolean => {
    const newFilter = buildNewFilter({
      columns,
      columnInference,
      tagLabels
    });

    if (!newFilter) {
      return false;
    }

    void applyFilters([...filters, newFilter]);
    return true;
  }, [applyFilters, columns, columnInference, filters, tagLabels]);

  useEffect(() => {
    const handleShortcutKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'f') {
        event.preventDefault();
        setSidebarCollapsed((value) => !value);
        return;
      }

      if (key === 'a') {
        const added = addFilterFromShortcut();
        if (!added) {
          return;
        }
        event.preventDefault();
        if (isSidebarCollapsed) {
          setSidebarCollapsed(false);
        }
      }
    };

    window.addEventListener('keydown', handleShortcutKey, true);
    return () => {
      window.removeEventListener('keydown', handleShortcutKey, true);
    };
  }, [addFilterFromShortcut, isSidebarCollapsed, setSidebarCollapsed]);

  const filterExpression = useMemo(() => buildFilterExpression(filters), [filters]);

  const labelFilterSummary = useMemo(
    () => summariseLabelFilters(filters, tagLabels),
    [filters, tagLabels]
  );

  const statusText = useMemo(() => {
    if (persistenceRestoring) {
      return 'Restoring previous session…';
    }

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
      base = `${base} • ${labelFilterSummary.summary}`;
    }

    if (persistenceError) {
      return `${base} • ${persistenceError}`;
    }

    if (persistenceLastSavedAt) {
      return `${base} • Auto-saved ${formatTime(persistenceLastSavedAt)}`;
    }

    return base;
  }, [
    persistenceRestoring,
    matchedRows,
    totalRows,
    loaderMessage,
    loaderStatus,
    stats,
    labelFilterSummary,
    persistenceError,
    persistenceLastSavedAt
  ]);

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

  const handleSaveNote = useCallback(
    async (note: string, labelId: string | null) => {
      if (!noteEditor) {
        return;
      }
      setNoteSaving(true);
      try {
        await applyTagToRows({ rowIds: [noteEditor.rowId], labelId, note });
        setNoteEditor(null);
      } catch (error) {
        console.error('Failed to save note', error);
      } finally {
        setNoteSaving(false);
      }
    },
    [applyTagToRows, noteEditor]
  );

  const handleClearNote = useCallback(
    async (labelId: string | null) => {
      if (!noteEditor) {
        return;
      }
      setNoteSaving(true);
      try {
        await applyTagToRows({ rowIds: [noteEditor.rowId], labelId, note: '' });
        setNoteEditor(null);
      } catch (error) {
        console.error('Failed to clear note', error);
      } finally {
        setNoteSaving(false);
      }
    },
    [applyTagToRows, noteEditor]
  );

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
        reportAppError('Failed to perform global search', error, {
          operation: 'grid.search'
        });
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
      reportAppError('File System Access API is not supported in this browser.', null, {
        operation: 'file.open'
      });
      return;
    }

    try {
      const openFilePicker = window.showOpenFilePicker;
      if (!openFilePicker) {
        reportAppError('File picker unavailable.', null, { operation: 'file.open' });
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
        reportAppError(
          error instanceof Error ? error.message : String(error),
          error,
          { operation: 'file.open' }
        );
      }
    }
  }, [clearSearchResult, setFileHandle]);

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

  const handleExportRows = useCallback(
    async (format: CsvExportFormat) => {
      if (!fileHandle || matchedRows === null || matchedRows === 0) {
        return;
      }

      setExportMenuOpen(false);
      setExporting(true);

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

        const headers = allColumns.map((column) => column.headerName);
        const csvRows = allRows.map((row) =>
          allColumns.map((column) => formatCellValue(row[column.key]))
        );
        const csvContent = serializeToCsv(headers, csvRows);
        const { blob, extension, mimeType } = await buildCsvBlob(csvContent, format);
        const filename = generateExportFilename(fileHandle.name, extension);

        await saveBlobFile({
          suggestedName: filename,
          blob,
          description: format === 'csv.gz' ? 'Compressed CSV export' : 'CSV export',
          mimeType,
          extensions: [extension]
        });
      } catch (error) {
        console.error('Failed to export CSV', error);
        reportAppError('Failed to export CSV', error, {
          operation: 'export.csv',
          context: { matchedRows, format }
        });
      } finally {
        setExporting(false);
      }
    },
    [fileHandle, matchedRows, allColumns, reportAppError]
  );

  const handleExportGrouping = useCallback(
    async (format: CsvExportFormat) => {
      if (groupingState.status !== 'ready' || groupingState.rows.length === 0) {
        return;
      }

      setExportMenuOpen(false);
      setExporting(true);

      try {
        const groupHeaders = groupingState.groupBy;
        const aggregateHeaders = Array.from(
          groupingState.rows.reduce((set, row) => {
            Object.keys(row.aggregates).forEach((alias) => set.add(alias));
            return set;
          }, new Set<string>())
        );
        const headers = [...groupHeaders, ...aggregateHeaders, 'rows'];
        const csvRows = groupingState.rows.map((row) => {
          const keyValues = Array.isArray(row.key) ? row.key : [row.key];
          const aggregates = aggregateHeaders.map((alias) => row.aggregates[alias]);
          return [
            ...keyValues.map(formatCellValue),
            ...aggregates.map(formatCellValue),
            row.rowCount.toString()
          ];
        });

        const csvContent = serializeToCsv(headers, csvRows);
        const { blob, extension, mimeType } = await buildCsvBlob(csvContent, format);
        const baseName = fileHandle?.name ?? 'grouping';
        const filename = generateExportFilename(`${baseName}-groups`, extension);

        await saveBlobFile({
          suggestedName: filename,
          blob,
          description: 'Grouping export',
          mimeType,
          extensions: [extension]
        });
      } catch (error) {
        console.error('Failed to export grouping data', error);
        reportAppError('Failed to export grouping data', error, {
          operation: 'export.grouping',
          context: { format }
        });
      } finally {
        setExporting(false);
      }
    },
    [groupingState, fileHandle, reportAppError]
  );

  const handleExportTags = useCallback(async () => {
    setExportMenuOpen(false);
    try {
      const response = await exportTags();
      if (response) {
        const json = JSON.stringify(response, null, 2);
        const suggestedName = buildTagExportFilename(
          response.source?.fileName ?? fileHandle?.name,
          response.exportedAt
        );
        await saveJsonFile({
          suggestedName,
          contents: json,
          description: 'Tag and note annotations'
        });
      }
    } catch (error) {
      console.error('Failed to export tags', error);
      reportAppError('Failed to export tags', error, {
        operation: 'export.tags'
      });
    }
  }, [exportTags, fileHandle]);

  const handleDownloadDiagnostics = useCallback(() => {
    if (!errorDetails) {
      return;
    }

    const payload = {
      ...errorDetails,
      session: getSessionSnapshot()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `diagnostics-${new Date().toISOString()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    clearErrorDetails();
  }, [clearErrorDetails, errorDetails]);

  const estimatedMemoryBytes =
    stats && typeof stats.bytesParsed === 'number'
      ? Math.round(stats.bytesParsed * 1.25)
      : null;
  const capabilityWarnings = capabilityReport?.warnings ?? [];
  const showCapabilityWarnings =
    capabilityReport.ok && capabilityWarnings.length > 0 && !warningsDismissed;
  const compressionSupported = typeof CompressionStream === 'function';
  const canExportRows =
    workerReady && Boolean(fileHandle) && matchedRows != null && matchedRows > 0;
  const canExportGrouping =
    workerReady && groupingState.status === 'ready' && groupingState.rows.length > 0;

  return (
    <div className="flex h-full flex-col bg-canvas text-slate-100">
      {showCapabilityWarnings && (
        <CapabilityWarningBanner
          warnings={capabilityWarnings}
          onDismiss={onDismissWarnings}
        />
      )}
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Tabular Analysis Workbench</h1>
          <span className="text-xs uppercase tracking-wide text-slate-400">
            {workerReady ? 'Data worker ready' : 'Initializing worker…'}
          </span>
          {persistenceRestoring && (
            <span className="text-xs uppercase tracking-wide text-amber-300">
              Restoring session…
            </span>
          )}
          {loaderMessage && (
            <span className="text-xs uppercase tracking-wide text-slate-500">
              {loaderMessage}
            </span>
          )}
          {persistenceError && (
            <span className="text-xs uppercase tracking-wide text-red-400">
              {persistenceError}
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
            disabled={!workerReady || loaderStatus === 'loading' || persistenceRestoring}
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
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
              onClick={() => setExportMenuOpen((value) => !value)}
              disabled={!workerReady || !fileHandle}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
            >
              Export ▾
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 z-20 mt-1 w-64 rounded border border-slate-700 bg-slate-950 text-left shadow-xl">
                <div className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Filtered rows
                </div>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                  onClick={() => handleExportRows('csv')}
                  disabled={!canExportRows || exporting}
                >
                  <span>.csv</span>
                  {exporting && <span className="text-[10px] text-slate-400">Working…</span>}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                  onClick={() => handleExportRows('csv.gz')}
                  disabled={!canExportRows || !compressionSupported || exporting}
                >
                  <span>.csv.gz</span>
                  {!compressionSupported && (
                    <span className="text-[10px] text-amber-400">Compression unavailable</span>
                  )}
                </button>
                <div className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Grouping
                </div>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                  onClick={() => handleExportGrouping('csv')}
                  disabled={!canExportGrouping || exporting}
                >
                  <span>.csv</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                  onClick={() => handleExportGrouping('csv.gz')}
                  disabled={!canExportGrouping || !compressionSupported || exporting}
                >
                  <span>.csv.gz</span>
                  {!compressionSupported && (
                    <span className="text-[10px] text-amber-400">Compression unavailable</span>
                  )}
                </button>
                <div className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Annotations
                </div>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                  onClick={handleExportTags}
                  disabled={!workerReady || !fileHandle}
                >
                  <span>Tags &amp; Notes (.json)</span>
                </button>
              </div>
            )}
          </div>
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
      {estimatedMemoryBytes != null && (
        <LargeDatasetWarning
          estimatedBytes={estimatedMemoryBytes}
          thresholdBytes={LARGE_DATASET_WARNING_BYTES}
          onOpenOptions={() => setOptionsOpen(true)}
        />
      )}
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
      <TagNotePanel
        open={noteEditor != null}
        rowId={noteEditor?.rowId ?? null}
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
      {errorDetails && (
        <DiagnosticsToast
          details={errorDetails}
          onDismiss={clearErrorDetails}
          onDownload={handleDownloadDiagnostics}
        />
      )}
    </div>
  );
};

const App = (): JSX.Element => {
  const [capabilityReport, setCapabilityReport] = useState<CapabilityReport>(() => detectCapabilities());
  const [warningsDismissed, setWarningsDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const refreshCapabilities = () => {
      setCapabilityReport((previous) => {
        const next = detectCapabilities();
        const previousWarningIds = (previous?.warnings ?? []).map((entry) => entry.id).join(',');
        const nextWarningIds = next.warnings.map((entry) => entry.id).join(',');
        if (previousWarningIds !== nextWarningIds) {
          setWarningsDismissed(false);
        }
        return next;
      });
    };

    window.addEventListener('focus', refreshCapabilities);
    window.addEventListener('visibilitychange', refreshCapabilities);

    return () => {
      window.removeEventListener('focus', refreshCapabilities);
      window.removeEventListener('visibilitychange', refreshCapabilities);
    };
  }, []);

  if (!capabilityReport.ok) {
    return <CapabilityGate report={capabilityReport} />;
  }

  return (
    <AppShell
      capabilityReport={capabilityReport}
      warningsDismissed={warningsDismissed}
      onDismissWarnings={() => setWarningsDismissed(true)}
    />
  );
};

export default App;
