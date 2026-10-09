import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { proxy } from 'comlink';

import { useAppStore } from '@state/appStore';
import { useDataStore } from '@state/dataStore';
import { describeFiles, getSessionSnapshot, useSessionStore } from '@state/sessionStore';
import { useTagStore } from '@state/tagStore';
import { useUndoStore } from '@state/undoStore';
import DataGrid from '@components/DataGrid';
import FilterBuilder, { buildNewFilter } from '@components/filter/FilterBuilder';
import { DidYouMeanBanner } from '@components/DidYouMeanBanner';
import PivotView from '@components/PivotView';
import ColumnsPanel from '@components/ColumnsPanel';
import LabelsPanel from '@components/LabelsPanel';
import OptionsPanel from '@components/options/OptionsPanel';
import TagNotePanel from '@components/tagging/TagNotePanel';
import CapabilityGate from '@components/CapabilityGate';
import CapabilityWarningBanner from '@components/CapabilityWarningBanner';
import DiagnosticsToast from '@components/DiagnosticsToast';
import { ExportMenu } from '@components/app/ExportMenu';
import { StatusBar } from '@components/app/StatusBar';
import { getDataWorker, isStaleOperation } from '@workers/dataWorkerProxy';
import { getFontStack } from '@constants/fonts';
import { summariseLabelFilters } from '@utils/labelFilters';
import { buildCsvBlob, generateExportFilename, serializeToCsv, type CsvExportFormat } from '@utils/csvExport';
import { saveBlobFile, saveJsonFile } from '@utils/fileAccess';
import { buildTagExportFilename } from '@utils/tagExport';
import { detectCapabilities, type CapabilityReport } from '@utils/capabilities';
import { clearStoredData } from '@utils/clearStoredData';
import { reportAppError } from '@utils/diagnostics';
import { buildFilterExpression } from '@utils/filterExpression';
import { useFilterSync } from '@/hooks/useFilterSync';
import { useGlobalSearchSync } from '@/hooks/useGlobalSearchSync';
import { useDiagnosticsReporter } from '@/hooks/useDiagnosticsReporter';
import { useWorkerBootstrap } from '@/hooks/useWorkerBootstrap';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';

const FILE_PICKER_TYPES = [
  {
    description: 'Delimited text',
    accept: {
      'text/csv': ['.csv'],
      'text/tab-separated-values': ['.tsv', '.txt'],
      'application/gzip': ['.gz']
    }
  }
];

interface AppShellProps {
  capabilityReport: CapabilityReport;
  warningsDismissed: boolean;
  onDismissWarnings: () => void;
}

/** Re-runs the active filter (and with it search and sort) so it covers rows that streamed in later. */
const refreshViewAfterLoad = async (): Promise<void> => {
  const { filters, sorts } = useSessionStore.getState();
  const { filterActive, searchActive } = useDataStore.getState();
  if (!filterActive && !searchActive && !sorts.length && !filters.length) {
    return;
  }
  const response = await getDataWorker().applyFilter({ expression: buildFilterExpression(filters) });
  useDataStore.getState().setMatchedRowCount(response.matchedRows);
  useDataStore.getState().bumpViewVersion();
};

const AppShell = ({ capabilityReport, warningsDismissed, onDismissWarnings }: AppShellProps): JSX.Element => {
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const searchCaseSensitive = useAppStore((state) => state.searchCaseSensitive);
  const setSearchCaseSensitive = useAppStore((state) => state.setSearchCaseSensitive);
  const interfaceFontFamily = useAppStore((state) => state.interfaceFontFamily);
  const interfaceFontSize = useAppStore((state) => state.interfaceFontSize);
  const dataFontFamily = useAppStore((state) => state.dataFontFamily);
  const dataFontSize = useAppStore((state) => state.dataFontSize);
  const fileHandles = useSessionStore((state) => state.fileHandles);
  const filters = useSessionStore((state) => state.filters);
  const columnLayout = useSessionStore((state) => state.columnLayout);
  const openFiles = useSessionStore((state) => state.openFiles);
  const loaderStatus = useDataStore((state) => state.status);
  const errorDetails = useDataStore((state) => state.errorDetails);
  const clearErrorDetails = useDataStore((state) => state.clearError);
  const matchedRows = useDataStore((state) => state.matchedRows);
  const columns = useDataStore((state) => state.columns);
  const columnInference = useDataStore((state) => state.columnInference);
  const groupingState = useDataStore((state) => state.grouping);
  const tagLabels = useTagStore((state) => state.labels);
  const tagRecords = useTagStore((state) => state.tags);
  const applyTagToRows = useTagStore((state) => state.applyTag);
  const exportTags = useTagStore((state) => state.exportTags);
  const { applyFilters } = useFilterSync();
  const workerReady = useWorkerBootstrap();
  const [searchTerm, setSearchTerm] = useState('');
  const [jumpTarget, setJumpTarget] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [showPivot, setShowPivot] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [noteEditor, setNoteEditor] = useState<{ rowId: number; labelIds: string[]; note: string } | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const jumpInputRef = useRef<HTMLInputElement | null>(null);

  useDiagnosticsReporter();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    // Horizontal trackpad swipes in the grid would otherwise navigate back and lose the session.
    history.pushState(null, '', location.href);
    const handlePopState = () => history.pushState(null, '', location.href);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-family', getFontStack(interfaceFontFamily));
    document.documentElement.style.setProperty('--app-font-size', `${interfaceFontSize}px`);
    document.documentElement.style.setProperty('--data-font-family', getFontStack(dataFontFamily));
    document.documentElement.style.setProperty('--data-font-size', `${dataFontSize}px`);
  }, [dataFontFamily, dataFontSize, interfaceFontFamily, interfaceFontSize]);

  const loadFiles = useCallback(async (handles: FileSystemFileHandle[]) => {
    const data = useDataStore.getState();
    data.startLoading(describeFiles(handles));
    useTagStore.getState().reset();
    useUndoStore.getState().clear();
    setSearchTerm('');
    setNoteEditor(null);
    setFileSize(null);
    void Promise.all(handles.map((handle) => handle.getFile())).then((files) =>
      setFileSize(files.reduce((total, file) => total + file.size, 0))
    );

    try {
      await getDataWorker().loadFile(
        { handles },
        proxy({
          onStart: ({ columns: header }) => useDataStore.getState().setHeader(header),
          onProgress: (progress) => useDataStore.getState().reportProgress(progress),
          onComplete: async (summary) => {
            useDataStore.getState().complete(summary);
            useSessionStore
              .getState()
              .initializeColumnLayout(Object.keys(summary.columnTypes), summary.columnInference, summary.rowsParsed);
            await useTagStore.getState().load();
            await refreshViewAfterLoad();
          },
          onError: (error) => useDataStore.getState().failLoading(error.message)
        })
      );
    } catch (error) {
      if (!isStaleOperation(error)) {
        reportAppError(error instanceof Error ? error.message : String(error), error, {
          operation: 'worker.loadFile',
          context: { files: handles.map((handle) => handle.name) }
        });
      }
    }
  }, []);

  useEffect(() => {
    if (workerReady && fileHandles.length) {
      void loadFiles(fileHandles);
    }
  }, [fileHandles, loadFiles, workerReady]);

  const handleOpenFile = useCallback(async () => {
    try {
      const handles = await window.showOpenFilePicker!({ multiple: true, types: FILE_PICKER_TYPES });
      if (handles.length) {
        openFiles(handles);
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        reportAppError(error instanceof Error ? error.message : String(error), error, { operation: 'file.open' });
      }
    }
  }, [openFiles]);

  const visibleColumnKeys = useMemo(
    () => columns.filter((column) => columnLayout.visibility[column.key] !== false).map((column) => column.key),
    [columnLayout.visibility, columns]
  );

  useGlobalSearchSync({ query: searchTerm, columns: visibleColumnKeys, enabled: workerReady && columns.length > 0 });

  const undoRedo = useCallback(
    async (direction: 'undo' | 'redo') => {
      const undo = useUndoStore.getState();
      const entry = direction === 'undo' ? undo.takeUndo() : undo.takeRedo();
      if (!entry) {
        return;
      }
      if (entry.kind === 'filters') {
        await applyFilters(direction === 'undo' ? entry.before : entry.after, { undoable: false });
      } else {
        await useTagStore.getState().restoreTags(direction === 'undo' ? entry.before : entry.after);
      }
    },
    [applyFilters]
  );

  useGlobalShortcuts({
    toggleFilters: () => setSidebarCollapsed((value) => !value),
    addFilter: () => {
      const filter = buildNewFilter({ columns, columnInference, tagLabels });
      if (filter) {
        setSidebarCollapsed(false);
        void applyFilters([...filters, filter]);
      }
    },
    focusSearch: () => searchInputRef.current?.focus(),
    focusJumpToRow: () => jumpInputRef.current?.focus(),
    undo: () => void undoRedo('undo'),
    redo: () => void undoRedo('redo')
  });

  const handleFlushStoredData = useCallback(async () => {
    await clearStoredData();
    window.location.reload();
  }, []);

  const openNoteEditor = useCallback(
    ({ rowId }: { rowId: number }) => {
      const record = tagRecords[rowId];
      setNoteEditor({ rowId, labelIds: record?.labelIds ?? [], note: record?.note ?? '' });
    },
    [tagRecords]
  );

  const saveNote = useCallback(
    async (note: string, labelIds: string[]) => {
      if (!noteEditor) {
        return;
      }
      setNoteSaving(true);
      try {
        await applyTagToRows({ rowIds: [noteEditor.rowId], labelIds, note, mode: 'replace' });
        setNoteEditor(null);
      } finally {
        setNoteSaving(false);
      }
    },
    [applyTagToRows, noteEditor]
  );

  const datasetName = describeFiles(fileHandles) || 'dataset';

  const handleExportRows = useCallback(
    async (scope: 'view' | 'labelled', format: CsvExportFormat) => {
      setExporting(true);
      try {
        const csv = await getDataWorker().exportCsv({
          scope,
          columns: columns
            .filter((column) => columnLayout.visibility[column.key] !== false)
            .map((column) => ({ key: column.key, header: column.headerName }))
        });
        const { blob, extension, mimeType } = await buildCsvBlob(csv, format);
        await saveBlobFile({
          suggestedName: generateExportFilename(scope === 'labelled' ? `${datasetName}-labelled` : datasetName, extension),
          blob,
          description: format === 'csv.gz' ? 'Compressed CSV export' : 'CSV export',
          mimeType,
          extensions: [extension]
        });
      } catch (error) {
        if ((error as DOMException)?.name !== 'AbortError') {
          reportAppError('Failed to export CSV', error, { operation: 'export.csv', context: { scope, format } });
        }
      } finally {
        setExporting(false);
      }
    },
    [columnLayout.visibility, columns, datasetName]
  );

  const handleExportGrouping = useCallback(
    async (format: CsvExportFormat) => {
      setExporting(true);
      try {
        const aliases = Array.from(new Set(groupingState.rows.flatMap((row) => Object.keys(row.aggregates))));
        const csv = serializeToCsv(
          [...groupingState.groupBy, ...aliases, 'rows'],
          groupingState.rows.map((row) => [
            ...(Array.isArray(row.key) ? row.key : [row.key]),
            ...aliases.map((alias) => row.aggregates[alias]),
            row.rowCount
          ])
        );
        const { blob, extension, mimeType } = await buildCsvBlob(csv, format);
        await saveBlobFile({
          suggestedName: generateExportFilename(`${datasetName}-groups`, extension),
          blob,
          description: 'Grouping export',
          mimeType,
          extensions: [extension]
        });
      } catch (error) {
        if ((error as DOMException)?.name !== 'AbortError') {
          reportAppError('Failed to export grouping data', error, { operation: 'export.grouping' });
        }
      } finally {
        setExporting(false);
      }
    },
    [datasetName, groupingState]
  );

  const handleExportTags = useCallback(async () => {
    try {
      const response = await exportTags();
      if (response) {
        await saveJsonFile({
          suggestedName: buildTagExportFilename(response.source?.fileName ?? datasetName, response.exportedAt),
          contents: JSON.stringify(response, null, 2),
          description: 'Label and note annotations'
        });
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        reportAppError('Failed to export tags', error, { operation: 'export.tags' });
      }
    }
  }, [datasetName, exportTags]);

  const handleDownloadDiagnostics = useCallback(() => {
    if (!errorDetails) {
      return;
    }
    const blob = new Blob([JSON.stringify({ ...errorDetails, session: getSessionSnapshot() }, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `diagnostics-${new Date().toISOString()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    clearErrorDetails();
  }, [clearErrorDetails, errorDetails]);

  const labelFilterSummary = useMemo(() => summariseLabelFilters(filters, tagLabels)?.summary ?? null, [filters, tagLabels]);
  const capabilityWarnings = capabilityReport.warnings ?? [];
  const hasData = workerReady && fileHandles.length > 0 && loaderStatus !== 'idle';

  return (
    <div className="flex h-full flex-col bg-canvas text-slate-100">
      {capabilityReport.ok && capabilityWarnings.length > 0 && !warningsDismissed && (
        <CapabilityWarningBanner warnings={capabilityWarnings} onDismiss={onDismissWarnings} />
      )}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-lg font-semibold">Tabular Analysis Workbench</h1>
          {fileHandles.length ? (
            <span className="truncate text-xs text-slate-400" title={fileHandles.map((handle) => handle.name).join('\n')}>
              {datasetName}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Search visible columns"
            placeholder="Search visible columns  ( / )"
            className="w-56 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearchTerm('');
                event.currentTarget.blur();
              } else if (event.key === 'Enter') {
                event.preventDefault();
                useDataStore.getState().navigateGrid({ kind: event.shiftKey ? 'previous' : 'next' });
              }
            }}
            disabled={!hasData}
          />
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={searchCaseSensitive}
              onChange={(event) => setSearchCaseSensitive(event.target.checked)}
            />
            Case sensitive
          </label>
          <form
            className="flex items-center"
            onSubmit={(event) => {
              event.preventDefault();
              const rowNumber = Number(jumpTarget);
              if (Number.isInteger(rowNumber) && rowNumber >= 1) {
                useDataStore.getState().navigateGrid({ kind: 'row', rowId: rowNumber - 1 });
              }
            }}
          >
            <input
              ref={jumpInputRef}
              type="number"
              min={1}
              aria-label="Go to row number"
              placeholder="Row #  ( g )"
              className="w-24 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200"
              value={jumpTarget}
              onChange={(event) => setJumpTarget(event.target.value)}
              disabled={!hasData}
            />
          </form>
          <button
            type="button"
            className="rounded bg-accent px-3 py-1 text-sm font-semibold text-slate-900"
            onClick={handleOpenFile}
            disabled={!workerReady || loaderStatus === 'loading'}
            title="Select several files to merge them into one timeline"
          >
            {loaderStatus === 'loading' ? 'Loading…' : 'Open Files'}
          </button>
          <button type="button" className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300" onClick={() => setOptionsOpen(true)}>
            Options
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
            onClick={() => setColumnsOpen(true)}
            disabled={!hasData}
          >
            Columns
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
            onClick={() => setLabelsOpen(true)}
            disabled={!hasData}
          >
            Labels
          </button>
          <ExportMenu
            disabled={!hasData}
            busy={exporting}
            canExportView={matchedRows != null && matchedRows > 0}
            canExportLabelled={Object.keys(tagRecords).length > 0}
            canExportGrouping={groupingState.status === 'ready' && groupingState.rows.length > 0}
            onExportRows={(scope, format) => void handleExportRows(scope, format)}
            onExportGrouping={(format) => void handleExportGrouping(format)}
            onExportAnnotations={() => void handleExportTags()}
          />
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
            onClick={() => setShowPivot((value) => !value)}
            disabled={!hasData || loaderStatus === 'loading'}
          >
            {showPivot ? 'Show Grid' : 'Pivot View'}
          </button>
          <button type="button" className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300" onClick={toggleTheme}>
            Toggle Theme
          </button>
        </div>
      </header>
      <main className="flex flex-1 overflow-hidden">
        <aside className={`hidden border-r border-slate-800 lg:block ${sidebarCollapsed ? 'w-6' : 'w-72'}`}>
          <div className="flex h-full flex-col">
            <button
              type="button"
              className="flex items-center justify-center border-b border-slate-800 py-2 text-xs text-slate-300 hover:bg-slate-900"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? 'Expand filters panel' : 'Collapse filters panel'}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? '»' : '«'}
            </button>
            {!sidebarCollapsed && (
              <div className="flex-1 overflow-auto p-4">
                <FilterBuilder columns={columns} />
              </div>
            )}
          </div>
        </aside>
        <section className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col overflow-hidden p-4">
            <DidYouMeanBanner />
            <div className="min-h-0 flex-1 rounded border border-slate-800">
              {showPivot ? (
                <PivotView />
              ) : (
                <DataGrid status={loaderStatus} searchQuery={searchTerm} onEditTagNote={openNoteEditor} />
              )}
            </div>
          </div>
          <StatusBar labelFilterSummary={labelFilterSummary} fileSize={fileSize} />
        </section>
      </main>
      <OptionsPanel open={optionsOpen} onClose={() => setOptionsOpen(false)} onFlushStoredData={handleFlushStoredData} />
      <LabelsPanel open={labelsOpen} onClose={() => setLabelsOpen(false)} />
      <ColumnsPanel open={columnsOpen} onClose={() => setColumnsOpen(false)} />
      <TagNotePanel
        open={noteEditor != null}
        rowId={noteEditor?.rowId ?? null}
        initialLabelIds={noteEditor?.labelIds ?? []}
        initialNote={noteEditor?.note ?? ''}
        onSave={saveNote}
        onClear={(labelIds) => saveNote('', labelIds)}
        onClose={() => !noteSaving && setNoteEditor(null)}
        saving={noteSaving}
      />
      {errorDetails && (
        <DiagnosticsToast details={errorDetails} onDismiss={clearErrorDetails} onDownload={handleDownloadDiagnostics} />
      )}
    </div>
  );
};

const App = (): JSX.Element => {
  const [capabilityReport, setCapabilityReport] = useState<CapabilityReport>(() => detectCapabilities());
  const [warningsDismissed, setWarningsDismissed] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setCapabilityReport((previous) => {
        const next = detectCapabilities();
        if (previous.warnings.map((entry) => entry.id).join() !== next.warnings.map((entry) => entry.id).join()) {
          setWarningsDismissed(false);
        }
        return next;
      });
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
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
