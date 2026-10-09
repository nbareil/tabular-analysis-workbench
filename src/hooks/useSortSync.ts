import { useCallback } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';
import { getDataWorker, isStaleOperation } from '@workers/dataWorkerProxy';
import type { SortDefinition } from '@workers/types';
import { reportAppError } from '@utils/diagnostics';

export interface UseSortSyncResult {
  sorts: SortDefinition[];
  applySorts: (nextSorts: SortDefinition[]) => Promise<void>;
}

export const useSortSync = (): UseSortSyncResult => {
  const sorts = useSessionStore((state) => state.sorts);
  const setSorts = useSessionStore((state) => state.setSorts);
  const setMatchedRowCount = useDataStore((state) => state.setMatchedRowCount);
  const bumpViewVersion = useDataStore((state) => state.bumpViewVersion);

  const applySorts = useCallback(
    async (nextSorts: SortDefinition[]) => {
      setSorts(nextSorts);
      try {
        const response = await getDataWorker().applySorts({ sorts: nextSorts });
        setSorts(response.sorts);
        setMatchedRowCount(response.matchedRows);
        bumpViewVersion();
      } catch (error) {
        if (isStaleOperation(error)) {
          return;
        }
        reportAppError('Failed to apply sorts', error, {
          operation: 'sorts.apply',
          context: { sortCount: nextSorts.length },
          retry: () => applySorts(nextSorts)
        });
      }
    },
    [bumpViewVersion, setMatchedRowCount, setSorts]
  );

  return { sorts, applySorts };
};
