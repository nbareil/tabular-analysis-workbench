import type { LabelDefinition } from '@workers/types';

interface TagPaletteProps {
  labels: LabelDefinition[];
  selectedLabelId: string | null;
  onSelect: (labelId: string | null) => void;
  disabled?: boolean;
}

const TagPalette = ({
  labels,
  selectedLabelId,
  onSelect,
  disabled = false
}: TagPaletteProps): JSX.Element => {
  const handleSelect = (labelId: string | null) => {
    if (!disabled) {
      onSelect(labelId);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm ${
          selectedLabelId == null
            ? 'border-accent/60 bg-accent/10 text-slate-100'
            : 'border-slate-800 text-slate-200 hover:bg-slate-800'
        }`}
        onClick={() => handleSelect(null)}
        disabled={disabled}
        aria-pressed={selectedLabelId == null}
      >
        <span className="font-medium">No label</span>
        <span className="text-xs uppercase tracking-wide text-slate-400">Default</span>
      </button>
      <div className="grid grid-cols-2 gap-2">
        {labels.map((label) => {
          const isSelected = selectedLabelId === label.id;
          return (
            <button
              key={label.id}
              type="button"
              className={`flex items-center justify-between rounded border px-3 py-2 text-left text-sm transition-colors ${
                isSelected
                  ? 'border-accent/60 bg-accent/10 text-slate-100'
                  : 'border-slate-800 text-slate-200 hover:bg-slate-800'
              }`}
              onClick={() => handleSelect(label.id)}
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
