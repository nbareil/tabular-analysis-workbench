import { useCallback, useEffect, useRef } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore, type SessionSnapshot } from '@state/sessionStore';
import { getDataWorker } from '@workers/dataWorkerProxy';
import { reportAppError } from '@utils/diagnostics';
import { isDebugLoggingEnabled, logDebug } from '@utils/debugLog';

type SortState = SessionSnapshot['sorts'][number];

const sortsEqual = (left: SortState[], right: SortState[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (sort, index) =>
      sort.column === right[index]?.column && sort.direction === right[index]?.direction
  );
};

interface ApplyOptions {
  persist?: boolean;
  progressive?: boolean;
  visibleRows?: number;
}

export interface UseSortSyncResult {
  sorts: SortState[];
  applySorts: (nextSorts: SortState[], options?: { progressive?: boolean; visibleRows?: number }) => Promise<void>;
  clearSorts: () => Promise<void>;
}

export const useSortSync = (): UseSortSyncResult => {
  const sorts = useSessionStore((state) => state.sorts);
  const setSorts = useSessionStore((state) => state.setSorts);
  const setMatchedRowCount = useDataStore((state) => state.setMatchedRowCount);
  const bumpViewVersion = useDataStore((state) => state.bumpViewVersion);
  const totalRows = useDataStore((state) => state.totalRows);
  const loaderStatus = useDataStore((state) => state.status);
  const bootstrapAppliedRef = useRef(false);
  const debugLoggingEnabled = isDebugLoggingEnabled();

  const applySortsInternal = useCallback(
    async (nextSorts: SortState[], options: ApplyOptions = {}): Promise<SortState[]> => {
      const { persist = true, progressive = false, visibleRows = 1000 } = options;

      try {
        if (debugLoggingEnabled) {
          logDebug('sorts', 'applySorts requested', {
            sortCount: nextSorts.length,
            sorts: nextSorts,
            progressive,
            visibleRows
          });
        }
        const worker = getDataWorker();
        const response = await worker.applySorts({
          sorts: nextSorts,
          offset: 0,
          limit: 0,
          progressive,
          visibleRows
        });

        if (debugLoggingEnabled) {
          logDebug('sorts', 'applySorts response', {
            matchedRows: response.matchedRows ?? null,
            totalRows: response.totalRows,
            sorts: response.sorts
          });
        }

        setMatchedRowCount(response.matchedRows ?? null);
        bumpViewVersion();
        bootstrapAppliedRef.current = true;

        if (persist) {
          setSorts(response.sorts);
        }

        return response.sorts;
      } catch (error) {
        console.error('Failed to apply sorts', error);
        reportAppError('Failed to apply sorts', error, {
          operation: 'sorts.apply',
          context: { sortCount: nextSorts.length },
          retry: () => applySortsInternal(nextSorts, options)
        });
        throw error;
      }
    },
    [bumpViewVersion, debugLoggingEnabled, setMatchedRowCount, setSorts]
  );

  const applySorts = useCallback(
    async (nextSorts: SortState[], options?: { progressive?: boolean; visibleRows?: number }) => {
      const { progressive = false, visibleRows = 1000 } = options || {};
      await applySortsInternal(nextSorts, { persist: true, progressive, visibleRows });
    },
    [applySortsInternal]
  );

  const clearSorts = useCallback(async () => {
    await applySorts([]);
  }, [applySorts]);

  useEffect(() => {
    if (!sorts.length) {
      bootstrapAppliedRef.current = false;
      return;
    }

    if (loaderStatus !== 'ready' || totalRows === 0) {
      if (debugLoggingEnabled) {
        logDebug('sorts', 'bootstrap deferred', {
          loaderStatus,
          totalRows,
          sortCount: sorts.length
        });
      }
      bootstrapAppliedRef.current = false;
      return;
    }

    if (bootstrapAppliedRef.current) {
      return;
    }

    if (debugLoggingEnabled) {
      logDebug('sorts', 'bootstrapping persisted sorts', {
        totalRows,
        sorts
      });
    }
    void applySortsInternal(sorts, { persist: false }).then((validSorts) => {
      if (!sortsEqual(validSorts, sorts)) {
        setSorts(validSorts);
      }
    });
  }, [applySortsInternal, debugLoggingEnabled, loaderStatus, setSorts, sorts, totalRows]);

  return { sorts, applySorts, clearSorts };
};
