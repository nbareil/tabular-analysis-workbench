import type { LabelDefinition } from '@workers/types';

interface TagPaletteProps {
  labels: LabelDefinition[];
  selectedLabelIds: string[];
  onChange: (labelIds: string[]) => void;
  disabled?: boolean;
}

const TagPalette = ({
  labels,
  selectedLabelIds,
  onChange,
  disabled = false
}: TagPaletteProps): JSX.Element => {
  const toggleLabel = (labelId: string | null) => {
    if (disabled) {
      return;
    }

    if (labelId === null) {
      onChange([]);
      return;
    }

    const isSelected = selectedLabelIds.includes(labelId);
    const next = isSelected
      ? selectedLabelIds.filter((id) => id !== labelId)
      : [...selectedLabelIds, labelId];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm ${
          selectedLabelIds.length === 0
            ? 'border-accent/60 bg-accent/10 text-slate-100'
            : 'border-slate-800 text-slate-200 hover:bg-slate-800'
        }`}
        onClick={() => toggleLabel(null)}
        disabled={disabled}
        aria-pressed={selectedLabelIds.length === 0}
      >
        <span className="font-medium">No label</span>
        <span className="text-xs uppercase tracking-wide text-slate-400">Default</span>
      </button>
      <div className="grid grid-cols-2 gap-2">
        {labels.map((label) => {
          const isSelected = selectedLabelIds.includes(label.id);
          return (
            <button
              key={label.id}
              type="button"
              className={`flex items-center justify-between rounded border px-3 py-2 text-left text-sm transition-colors ${
                isSelected
                    ? 'border-accent/60 bg-accent/10 text-slate-100'
                    : 'border-slate-800 text-slate-200 hover:bg-slate-800'
              }`}
              onClick={() => toggleLabel(label.id)}
              disabled={disabled}
              aria-pressed={isSelected}
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: label.color }}
                  aria-hidden
                />
                <span className="truncate">{label.name}</span>
              </span>
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                {label.description ? 'Custom' : 'Label'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TagPalette;
