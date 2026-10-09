import { useEffect } from 'react';

import { useAppStore } from '@state/appStore';
import { useDataStore } from '@state/dataStore';
import { getDataWorker, isStaleOperation } from '@workers/dataWorkerProxy';
import { reportAppError } from '@utils/diagnostics';

const SEARCH_DEBOUNCE_MS = 250;

interface UseGlobalSearchSyncOptions {
  query: string;
  columns: string[];
  enabled: boolean;
}

/** Debounces the search box into worker searches; the worker re-sorts the matches itself. */
export const useGlobalSearchSync = ({ query, columns, enabled }: UseGlobalSearchSyncOptions): void => {
  const setSearchResult = useDataStore((state) => state.setSearchResult);
  const clearSearchResult = useDataStore((state) => state.clearSearchResult);
  const bumpViewVersion = useDataStore((state) => state.bumpViewVersion);
  const searchActive = useDataStore((state) => state.searchActive);
  const caseSensitive = useAppStore((state) => state.searchCaseSensitive);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || (!trimmed && !searchActive)) {
      return undefined;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const response = await getDataWorker().globalSearch({ query: trimmed, columns, caseSensitive });
        if (trimmed) {
          setSearchResult(response);
        } else {
          clearSearchResult(response.matchedRows);
        }
        bumpViewVersion();
      } catch (error) {
        if (!isStaleOperation(error)) {
          reportAppError('Failed to perform global search', error, { operation: 'grid.search' });
        }
      }
    }, trimmed ? SEARCH_DEBOUNCE_MS : 0);

    return () => window.clearTimeout(timeout);
    // searchActive is read when the effect runs but must not retrigger a search by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, columns, enabled, caseSensitive, setSearchResult, clearSearchResult, bumpViewVersion]);
};
