import { useCallback, useEffect, useRef } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore, type SessionSnapshot } from '@state/sessionStore';
import { getDataWorker } from '@workers/dataWorkerProxy';

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
  const bootstrapAppliedRef = useRef(false);

  const applySortsInternal = useCallback(
    async (nextSorts: SortState[], options: ApplyOptions = {}): Promise<SortState[]> => {
      const { persist = true, progressive = false, visibleRows = 1000 } = options;

      try {
        const worker = getDataWorker();
        const response = await worker.applySorts({
          sorts: nextSorts,
          offset: 0,
          limit: 0,
          progressive,
          visibleRows
        });

        setMatchedRowCount(response.matchedRows ?? null);
        bumpViewVersion();
        bootstrapAppliedRef.current = true;

        if (persist) {
          setSorts(response.sorts);
        }

        return response.sorts;
      } catch (error) {
        console.error('Failed to apply sorts', error);
        throw error;
      }
    },
    [bumpViewVersion, setMatchedRowCount, setSorts]
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

    if (totalRows === 0) {
      bootstrapAppliedRef.current = false;
      return;
    }

    if (bootstrapAppliedRef.current) {
      return;
    }

    void applySortsInternal(sorts, { persist: false }).then((validSorts) => {
      if (!sortsEqual(validSorts, sorts)) {
        setSorts(validSorts);
      }
    });
  }, [applySortsInternal, setSorts, sorts, totalRows]);

  return { sorts, applySorts, clearSorts };
};
