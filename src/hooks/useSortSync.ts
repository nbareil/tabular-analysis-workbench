import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';
import { getDataWorker, isStaleOperation } from '@workers/dataWorkerProxy';
import type { SortDefinition } from '@workers/types';
import { reportAppError } from '@utils/diagnostics';

/** Sorts the current view in the worker; unknown columns are dropped from the stored sorts. */
export const applySorts = async (nextSorts: SortDefinition[]): Promise<void> => {
  const session = useSessionStore.getState();
  session.setSorts(nextSorts);
  try {
    const response = await getDataWorker().applySorts({ sorts: nextSorts });
    session.setSorts(response.sorts);
    useDataStore.getState().setMatchedRowCount(response.matchedRows);
    useDataStore.getState().bumpViewVersion();
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
};

export interface UseSortSyncResult {
  sorts: SortDefinition[];
  applySorts: typeof applySorts;
}

export const useSortSync = (): UseSortSyncResult => ({
  sorts: useSessionStore((state) => state.sorts),
  applySorts
});
