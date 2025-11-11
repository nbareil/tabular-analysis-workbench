import type { CapabilityReport } from '@utils/capabilities';

interface CapabilityGateProps {
  report: CapabilityReport;
}

export const CapabilityGate = ({ report }: CapabilityGateProps): JSX.Element => {
  if (report.ok) {
    return <></>;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
      <div className="max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold text-slate-50">Browser not supported</h1>
        <p className="text-sm text-slate-300">
          This tool relies on modern Chromium APIs such as the File System Access API and
          DecompressionStream. Please open it in a recent Chromium-based browser (Chrome,
          Edge, Brave) with experimental features enabled.
        </p>
        <div className="rounded border border-red-400/40 bg-red-400/10 p-4 text-left">
          <p className="text-sm font-semibold text-red-200">Missing requirements</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-100">
            {report.blocking.map((entry) => (
              <li key={entry.id}>
                <span className="font-semibold">{entry.label}:</span> {entry.description}
              </li>
            ))}
          </ul>
        </div>
        {report.warnings.length > 0 && (
          <div className="rounded border border-amber-400/40 bg-amber-400/10 p-4 text-left">
            <p className="text-sm font-semibold text-amber-200">Limited functionality</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100">
              {report.warnings.map((entry) => (
                <li key={entry.id}>
                  <span className="font-semibold">{entry.label}:</span> {entry.description}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-slate-500">
          UA detection avoided; capability probing refreshes automatically when features become
          available.
        </p>
      </div>
    </div>
  );
};

export default CapabilityGate;
