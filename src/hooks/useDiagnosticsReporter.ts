import { useEffect } from 'react';

import { reportAppError } from '@utils/diagnostics';

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
      reportAppError('Unhandled promise rejection', event.reason, {
        operation: 'window.unhandledrejection'
      });
      event.preventDefault();
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);
};
