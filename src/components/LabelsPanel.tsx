import { useEffect, useMemo, useState } from 'react';

import { useTagStore } from '@state/tagStore';

interface LabelsPanelProps {
  open: boolean;
  onClose: () => void;
}

const randomColor = (): string => {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 60%)`;
};

const LabelsPanel = ({ open, onClose }: LabelsPanelProps): JSX.Element | null => {
  const { labels, status, error, load, upsertLabel, deleteLabel } = useTagStore();
  const [labelName, setLabelName] = useState('');

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
    }
  }, [open]);

  const sortedLabels = useMemo(
    () => labels.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [labels]
  );

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

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70">
      <div className="w-full max-w-2xl rounded border border-slate-700 bg-slate-900 shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Labels</h2>
          <div className="flex gap-2 text-xs">
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
            <div className="rounded border border-dashed border-slate-700 p-3 text-xs text-slate-400">
              <p className="font-semibold text-slate-300">Coming soon</p>
              <p>
                The full tagging experience will allow bulk edits, keyboard shortcuts, and inline notes.
                This panel scaffolds the label catalog so implementation can plug in later.
              </p>
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
                  className="flex items-center justify-between gap-3 rounded border border-slate-800 px-3 py-2"
                >
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
                  <button
                    type="button"
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-red-900/40"
                    onClick={() => handleDelete(label.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

export default LabelsPanel;
