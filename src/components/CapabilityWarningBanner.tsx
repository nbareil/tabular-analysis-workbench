import type { CapabilityDetail } from '@utils/capabilities';

interface CapabilityWarningBannerProps {
  warnings: CapabilityDetail[];
  onDismiss?: () => void;
}

export const CapabilityWarningBanner = ({
  warnings,
  onDismiss
}: CapabilityWarningBannerProps): JSX.Element | null => {
  if (!warnings.length) {
    return null;
  }

  return (
    <div className="flex items-start justify-between border-b border-amber-500/40 bg-amber-950/40 px-4 py-2 text-xs text-amber-100">
      <div className="space-y-1">
        <p className="font-semibold uppercase tracking-wide text-amber-200">
          Limited persistence
        </p>
        <ul className="list-disc space-y-0.5 pl-4">
          {warnings.map((warning) => (
            <li key={warning.id}>
              <span className="font-semibold">{warning.label}:</span> {warning.description}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-amber-200/70">
          Session auto-save is disabled until these capabilities are available.
        </p>
      </div>
      <button
        type="button"
        className="text-amber-300 transition hover:text-amber-100"
        onClick={onDismiss}
        aria-label="Dismiss capability warning"
      >
        Dismiss
      </button>
    </div>
  );
};

export default CapabilityWarningBanner;
