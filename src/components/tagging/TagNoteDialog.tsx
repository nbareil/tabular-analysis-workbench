import { useEffect, useState } from 'react';

import { useTagStore } from '@state/tagStore';

interface TagNoteDialogProps {
  open: boolean;
  initialLabelId: string | null;
  initialNote: string;
  onSave: (note: string, labelId: string | null) => void;
  onClear: (labelId: string | null) => void;
  onClose: () => void;
  saving?: boolean;
}

const TagNoteDialog = ({
  open,
  initialLabelId,
  initialNote,
  onSave,
  onClear,
  onClose,
  saving = false
}: TagNoteDialogProps): JSX.Element | null => {
  const { labels } = useTagStore();
  const [note, setNote] = useState(initialNote);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(initialLabelId);

  useEffect(() => {
    if (open) {
      setNote(initialNote);
      setSelectedLabelId(initialLabelId);
    }
  }, [initialNote, initialLabelId, open]);

  const selectedLabel = labels.find(l => l.id === selectedLabelId);

  if (!open) {
    return null;
  }

  const handleSubmit = () => {
    onSave(note.trim(), selectedLabelId);
  };

  const handleClear = () => {
    onClear(selectedLabelId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70">
      <div className="w-full max-w-lg rounded border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Edit note</h2>
        {selectedLabel ? (
        <span className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-300">
        <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: selectedLabel.color }}
        aria-hidden
        />
        {selectedLabel.name}
        </span>
        ) : (
        <span className="text-[11px] uppercase tracking-wide text-slate-500">No label</span>
        )}
        </div>
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>
        </header>
        <div className="space-y-4 px-4 py-4">
        <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-slate-400">Label</label>
        <select
        value={selectedLabelId ?? ''}
        onChange={(event) => setSelectedLabelId(event.target.value || null)}
        className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        disabled={saving}
        >
        <option value="">No label</option>
          {labels.map((label) => (
              <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wide text-slate-400">Markdown note</label>
            <textarea
              rows={6}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add context for this row…"
              disabled={saving}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-1 text-red-300 hover:bg-red-900/40 disabled:opacity-40"
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
                className="rounded bg-accent px-3 py-1 font-semibold text-slate-900 disabled:opacity-40"
                onClick={handleSubmit}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TagNoteDialog;
