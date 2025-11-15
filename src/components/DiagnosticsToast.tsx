import { useMemo, useState } from 'react';

import type { DataState } from '@state/dataStore';

interface DiagnosticsToastProps {
  details: NonNullable<DataState['errorDetails']>;
  onDismiss: () => void;
  onDownload: () => void;
}

const DiagnosticsToast = ({
  details,
  onDismiss,
  onDownload
}: DiagnosticsToastProps): JSX.Element => {
  const [retrying, setRetrying] = useState(false);
  const payload = useMemo(() => {
    return (details.payload ?? {}) as {
      operation?: string;
      context?: Record<string, unknown>;
      retry?: (() => Promise<unknown> | unknown) | null;
    };
  }, [details.payload]);

  const hasRetry = typeof payload.retry === 'function';

  const handleRetry = async () => {
    if (!hasRetry || !payload.retry) {
      return;
    }

    try {
      setRetrying(true);
      await payload.retry();
      onDismiss();
    } catch (error) {
      console.error('[diagnostics-toast] Retry failed', error);
      setRetrying(false);
    }
  };

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-20 max-w-sm rounded-lg border border-red-500/40 bg-slate-900/95 p-4 text-sm shadow-2xl">
      <div className="flex items-start gap-3">
        <div className="text-red-400">
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="flex-1 space-y-1 text-slate-100">
          <p className="font-semibold text-red-200">{details.message}</p>
          {payload.operation && (
            <p className="text-xs uppercase tracking-wide text-slate-400">{payload.operation}</p>
          )}
          <p className="text-xs text-slate-400">
            Logged at {new Date(details.timestamp).toLocaleTimeString()}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {hasRetry && (
          <button
            type="button"
            className="rounded bg-red-500/90 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
        <button
          type="button"
          className="rounded border border-slate-500 px-3 py-1 text-xs text-slate-100"
          onClick={onDownload}
        >
          Download diagnostics
        </button>
        <button
          type="button"
          className="rounded border border-transparent px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};

export default DiagnosticsToast;
