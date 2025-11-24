import { useEffect, useMemo, useRef, useState } from 'react';

import { useTagStore } from '@state/tagStore';
import TagPalette from './TagPalette';
import MarkdownEditor from './MarkdownEditor';
import { renderMarkdownToSafeHtml } from '@utils/markdown';
import { shallow } from 'zustand/shallow';

interface TagNotePanelProps {
  open: boolean;
  rowId: number | null;
  initialLabelIds: string[];
  initialNote: string;
  onSave: (note: string, labelIds: string[]) => void | Promise<void>;
  onClear: (labelIds: string[]) => void | Promise<void>;
  onClose: () => void;
  saving?: boolean;
}

const TagNotePanel = ({
  open,
  rowId,
  initialLabelIds,
  initialNote,
  onSave,
  onClear,
  onClose,
  saving = false
}: TagNotePanelProps): JSX.Element | null => {
  const { labels, status, error } = useTagStore(
    (state) => ({
      labels: state.labels,
      status: state.status,
      error: state.error
    }),
    shallow
  );
  const load = useTagStore((state) => state.load);
  const [note, setNote] = useState(initialNote);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(initialLabelIds);

  const activeRowRef = useRef<number | null>(rowId ?? null);

  useEffect(() => {
    if (!open) {
      activeRowRef.current = null;
      return;
    }

    const rowChanged = activeRowRef.current !== (rowId ?? null);
    if (rowChanged) {
      activeRowRef.current = rowId ?? null;
      setNote(initialNote);
      setSelectedLabelIds(initialLabelIds);
    }

    if (status === 'idle') {
      void load();
    }
  }, [initialLabelIds, initialNote, load, open, rowId, status]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open, saving]);

  const previewHtml = useMemo(() => renderMarkdownToSafeHtml(note), [note]);
  const selectedLabels = useMemo(() => {
    if (!selectedLabelIds.length) {
      return [];
    }
    const ids = new Set(selectedLabelIds);
    return labels.filter((label) => ids.has(label.id));
  }, [labels, selectedLabelIds]);

  if (!open) {
    return null;
  }

  const handleSave = () => {
    onSave(note.trim(), selectedLabelIds);
  };

  const handleClear = () => {
    onClear(selectedLabelIds);
  };

  const handleOverlayClick = () => {
    if (!saving) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-slate-950/70" onClick={handleOverlayClick} />
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Row annotation</p>
            <p className="text-lg font-semibold text-slate-100">
              Row {rowId != null ? `#${rowId}` : 'selection'}
            </p>
            <p className="text-xs text-slate-400">
              {selectedLabels.length > 0 ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {selectedLabels.slice(0, 3).map((label) => (
                    <span key={label.id} className="inline-flex items-center gap-1">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: label.color }}
                        aria-hidden
                      />
                      {label.name}
                    </span>
                  ))}
                  {selectedLabels.length > 3 ? (
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      +{selectedLabels.length - 3} more
                    </span>
                  ) : null}
                </span>
              ) : (
                'No labels selected'
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <section className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Label palette</p>
              <p className="text-xs text-slate-400">
                Apply one or more labels to this row. Labels sync with the Labels panel.
              </p>
            </div>
            {status === 'loading' && (
              <p className="text-xs text-slate-400">Loading labels…</p>
            )}
            {error && status === 'error' && (
              <p className="text-xs text-red-400">Failed to load labels: {error}</p>
            )}
            <TagPalette
              labels={labels}
              selectedLabelIds={selectedLabelIds}
              onChange={setSelectedLabelIds}
              disabled={saving || status === 'loading'}
            />
          </section>
          <section className="mt-6 space-y-3">
            <div>
              <p className="text-sm font-semibold">Markdown note</p>
              <p className="text-xs text-slate-400">
                Use markdown for links, lists, and emphasis. Preview updates live.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wide text-slate-500">
                  Write <span className="text-slate-400">(Cmd/Ctrl + Enter saves)</span>
                </label>
                <MarkdownEditor
                  value={note}
                  onChange={setNote}
                  placeholder="Add context for this row…"
                  disabled={saving}
                  autoFocus
                  onSubmitShortcut={() => {
                    if (!saving) {
                      handleSave();
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wide text-slate-500">Preview</label>
                <div
                  className="h-56 overflow-auto rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  data-testid="note-preview"
                >
                  {previewHtml ? (
                    <div
                      className="prose prose-invert max-w-none text-sm"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  ) : (
                    <p className="text-slate-500">Nothing to preview yet.</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
        <footer className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-sm">
          <button
            type="button"
            className="rounded border border-red-500/60 px-3 py-1 text-red-200 hover:bg-red-900/40 disabled:opacity-40"
            onClick={handleClear}
            disabled={saving}
          >
            Clear note
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-accent px-4 py-1 font-semibold text-slate-900 disabled:opacity-40"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
};

export default TagNotePanel;
