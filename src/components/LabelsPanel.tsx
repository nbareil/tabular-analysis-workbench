import { useEffect, useMemo, useState } from 'react';

import type { FilterState } from '@state/sessionStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import { useTagStore } from '@state/tagStore';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from '@workers/types';
import { parseTagExport } from '@utils/tagExport';
import { shallow } from 'zustand/shallow';

interface LabelsPanelProps {
  open: boolean;
  onClose: () => void;
}

const randomColor = (): string => {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 60%)`;
};

const LabelsPanel = ({ open, onClose }: LabelsPanelProps): JSX.Element | null => {
  const { labels, status, error } = useTagStore(
    (state) => ({
      labels: state.labels,
      status: state.status,
      error: state.error
    }),
    shallow
  );
  const load = useTagStore((state) => state.load);
  const upsertLabel = useTagStore((state) => state.upsertLabel);
  const deleteLabel = useTagStore((state) => state.deleteLabel);
  const importTags = useTagStore((state) => state.importTags);
  const { filters, applyFilters } = useFilterSync();
  const [labelName, setLabelName] = useState('');
  const [mergeStrategy, setMergeStrategy] = useState<'merge' | 'replace'>('merge');
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (status === 'idle') {
      void load();
    }
  }, [load, open, status]);

  useEffect(() => {
    if (!open) {
      setLabelName('');
      setImportFeedback(null);
      setImportErrorMessage(null);
    }
  }, [open]);

  const sortedLabels = useMemo(
    () => labels.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [labels]
  );

  const labelFilters = useMemo(
    () => filters.filter((filter) => filter.column === TAG_COLUMN_ID && filter.enabled !== false),
    [filters]
  );

  const handleShowOnly = (labelId: string | null) => {
    const value = labelId ?? TAG_NO_LABEL_FILTER_VALUE;
    const nonLabelFilters = filters.filter((filter) => filter.column !== TAG_COLUMN_ID);
    const nextFilter: FilterState = {
      id: crypto.randomUUID(),
      column: TAG_COLUMN_ID,
      operator: 'eq',
      value,
      enabled: true
    };

    void applyFilters([...nonLabelFilters, nextFilter]);
  };

  const handleExclude = (labelId: string | null) => {
    const value = labelId ?? TAG_NO_LABEL_FILTER_VALUE;
    const withoutDuplicate = filters.filter(
      (filter) =>
        !(
          filter.column === TAG_COLUMN_ID &&
          filter.operator === 'neq' &&
          String(filter.value ?? '') === value
        )
    );

    const nextFilter: FilterState = {
      id: crypto.randomUUID(),
      column: TAG_COLUMN_ID,
      operator: 'neq',
      value,
      enabled: true
    };

    void applyFilters([...withoutDuplicate, nextFilter]);
  };

  const handleClearLabelFilters = () => {
    const nonLabelFilters = filters.filter((filter) => filter.column !== TAG_COLUMN_ID);
    void applyFilters(nonLabelFilters);
  };

  const isLabelIncluded = (labelId: string | null): boolean => {
    const value = labelId ?? TAG_NO_LABEL_FILTER_VALUE;
    return labelFilters.some(
      (filter) =>
        filter.enabled !== false && filter.operator === 'eq' && String(filter.value ?? '') === value
    );
  };

  const isLabelExcluded = (labelId: string | null): boolean => {
    const value = labelId ?? TAG_NO_LABEL_FILTER_VALUE;
    return labelFilters.some(
      (filter) =>
        filter.enabled !== false && filter.operator === 'neq' && String(filter.value ?? '') === value
    );
  };

  const handleCreateLabel = async () => {
    if (!labelName.trim()) {
      return;
    }

    await upsertLabel({
      name: labelName.trim(),
      color: randomColor()
    });
    setLabelName('');
  };

  const handleDelete = (id: string) => {
    void deleteLabel(id);
  };

  const handleImport = async () => {
    if (!('showOpenFilePicker' in window)) {
      alert('File System Access API is not supported in this browser.');
      return;
    }

    setImportFeedback(null);
    setImportErrorMessage(null);
    setImporting(true);

    try {
      const openFilePicker = window.showOpenFilePicker!;
      const [handle] = await openFilePicker({
        types: [
          {
            description: 'JSON files',
            accept: { 'application/json': ['.json'] }
          }
        ]
      });
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = parseTagExport(JSON.parse(text));
      const response = await importTags(parsed.snapshot, mergeStrategy);

      if (!response) {
        throw new Error('Failed to import annotations.');
      }

      const labelCount = response.labels.length;
      const annotationCount = Object.keys(response.tags).length;
      const labelPlural = labelCount === 1 ? 'label' : 'labels';
      const annotationPlural = annotationCount === 1 ? 'annotation' : 'annotations';
      const sourceName = parsed.metadata?.source?.fileName ?? file.name;
      const context = sourceName ? ` from ${sourceName}` : '';
      setImportFeedback(
        `Imported ${labelCount} ${labelPlural} and ${annotationCount} ${annotationPlural}${context}.`
      );
    } catch (error) {
      console.error('Failed to import tags', error);
      setImportErrorMessage(
        error instanceof Error ? error.message : 'Failed to import annotations.'
      );
    } finally {
      setImporting(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70">
      <div className="w-full max-w-2xl rounded border border-slate-700 bg-slate-900 shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Labels</h2>
          <div className="flex gap-2 text-xs">
            {labelFilters.length > 0 ? (
              <button
                type="button"
                className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
                onClick={handleClearLabelFilters}
              >
                Clear label filters
              </button>
            ) : null}
            <button
              type="button"
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </header>
        <div className="grid gap-4 px-4 py-3 text-sm text-slate-200 md:grid-cols-[2fr_3fr]">
          <section className="space-y-3">
            <div className="space-y-2">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Create label
                <input
                  type="text"
                  value={labelName}
                  placeholder="Label name"
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                  onChange={(event) => setLabelName(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                onClick={handleCreateLabel}
                disabled={!labelName.trim()}
              >
                Add label
              </button>
            </div>
            <div className="space-y-2">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Import tags
                <select
                  value={mergeStrategy}
                  onChange={(e) => setMergeStrategy(e.target.value as 'merge' | 'replace')}
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                >
                  <option value="merge">Merge with existing</option>
                  <option value="replace">Replace all</option>
                </select>
              </label>
              <button
                type="button"
                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? 'Importing…' : 'Import Tags'}
              </button>
              {importFeedback && (
                <p className="text-xs text-emerald-400">{importFeedback}</p>
              )}
              {importErrorMessage && (
                <p className="text-xs text-red-400">{importErrorMessage}</p>
              )}
            </div>
          </section>
          <section className="space-y-2 overflow-auto">
            {status === 'loading' && (
              <p className="text-xs text-slate-400">Loading labels…</p>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
            {!sortedLabels.length && status === 'ready' && (
              <p className="text-xs text-slate-400">No labels yet. Create one to get started.</p>
            )}
            <ul className="space-y-2">
              {sortedLabels.map((label) => (
                <li
                  key={label.id}
                  className="flex flex-col gap-2 rounded border border-slate-800 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span
                        className="h-4 w-4 rounded-full"
                        style={{ backgroundColor: label.color }}
                        aria-hidden
                      />
                      <div>
                        <p className="font-medium text-slate-100">{label.name}</p>
                        {label.description && (
                          <p className="text-xs text-slate-400">{label.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                        onClick={() => handleShowOnly(label.id)}
                        disabled={isLabelIncluded(label.id)}
                      >
                        Show only
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                        onClick={() => handleExclude(label.id)}
                        disabled={isLabelExcluded(label.id)}
                      >
                        Exclude
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-red-300 hover:bg-red-900/40"
                        onClick={() => handleDelete(label.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              <li className="flex flex-col gap-2 rounded border border-dashed border-slate-800 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-100">No label</p>
                    <p className="text-xs text-slate-400">Rows without labels or notes.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                      onClick={() => handleShowOnly(null)}
                      disabled={isLabelIncluded(null)}
                    >
                      Show only
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                      onClick={() => handleExclude(null)}
                      disabled={isLabelExcluded(null)}
                    >
                      Exclude
                    </button>
                  </div>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

export default LabelsPanel;
