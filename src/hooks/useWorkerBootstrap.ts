import { useEffect, useState } from 'react';

import { getDataWorker } from '@workers/dataWorkerProxy';
import { isDebugLoggingEnabled } from '@utils/debugLog';
import { reportAppError } from '@utils/diagnostics';

/**
 * Initialises the data worker once and flushes pending label edits whenever the page is hidden.
 * `visibilitychange` fires reliably before a tab closes, unlike an async `beforeunload` handler.
 */
export const useWorkerBootstrap = (): boolean => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const worker = getDataWorker();
    worker
      .init({ debugLogging: isDebugLoggingEnabled(), slowBatchThresholdMs: 50 })
      .then(() => !cancelled && setReady(true))
      .catch((error) => reportAppError('Failed to initialize data worker', error, { operation: 'worker.init' }));

    const flush = () => {
      if (document.visibilityState === 'hidden') {
        void worker.persistTags().catch((error) => console.warn('Failed to persist labels', error));
      }
    };
    document.addEventListener('visibilitychange', flush);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  return ready;
};
