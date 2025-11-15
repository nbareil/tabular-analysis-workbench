import { formatBytes } from '@utils/formatBytes';

interface LargeDatasetWarningProps {
  estimatedBytes: number;
  thresholdBytes: number;
  onOpenOptions: () => void;
}

export const LargeDatasetWarning = ({
  estimatedBytes,
  thresholdBytes,
  onOpenOptions
}: LargeDatasetWarningProps): JSX.Element | null => {
  if (!Number.isFinite(estimatedBytes) || estimatedBytes < thresholdBytes) {
    return null;
  }

  return (
    <div className="mb-2 flex items-start justify-between gap-3 rounded border border-amber-500/60 bg-amber-950/60 px-3 py-2 text-xs text-amber-100">
      <div>
        <p className="font-semibold uppercase tracking-wide text-amber-200">
          Large dataset detected
        </p>
        <p className="text-amber-100/80">
          Estimated footprint {formatBytes(estimatedBytes)} exceeds{' '}
          {formatBytes(thresholdBytes)}. Consider reducing batch size or disabling fuzzy search in
          Options to stay within the 600&nbsp;MB budget.
        </p>
      </div>
      <button
        type="button"
        className="rounded border border-amber-500/80 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-100 hover:bg-amber-500/10"
        onClick={onOpenOptions}
      >
        Options
      </button>
    </div>
  );
};

export default LargeDatasetWarning;
