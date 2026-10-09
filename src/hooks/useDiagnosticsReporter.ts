import { useEffect } from 'react';

import { reportAppError } from '@utils/diagnostics';
import { isStaleOperation } from '@workers/dataWorkerProxy';

export const useDiagnosticsReporter = (): void => {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleError = (event: ErrorEvent) => {
      reportAppError(event.message ?? 'Unexpected error', event.error, {
        operation: 'window.error'
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      if (isStaleOperation(event.reason)) {
        return;
      }
      reportAppError('Unhandled promise rejection', event.reason, {
        operation: 'window.unhandledrejection'
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);
};
