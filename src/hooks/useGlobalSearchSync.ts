import { useEffect, useRef } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';
import { getDataWorker } from '@workers/dataWorkerProxy';
import { reportAppError } from '@utils/diagnostics';

const SEARCH_DEBOUNCE_MS = 250;
const PROGRESSIVE_SORT_THRESHOLD = 50_000;
const PROGRESSIVE_VISIBLE_ROWS = 2_000;

interface UseGlobalSearchSyncOptions {
  query: string;
  columns: string[];
  enabled: boolean;
}

export const useGlobalSearchSync = ({
  query,
  columns,
  enabled
}: UseGlobalSearchSyncOptions): void => {
  const setSearchResult = useDataStore((state) => state.setSearchResult);
  const clearSearchResult = useDataStore((state) => state.clearSearchResult);
  const bumpViewVersion = useDataStore((state) => state.bumpViewVersion);
  const searchMatchedRows = useDataStore((state) => state.searchMatchedRows);
  const totalRows = useDataStore((state) => state.totalRows);
  const filterMatchedRows = useDataStore((state) => state.filterMatchedRows);
  const searchCaseSensitive = useSessionStore((state) => state.searchCaseSensitive);
  const sorts = useSessionStore((state) => state.sorts);
  const requestIdRef = useRef(0);
  const sortsRef = useRef(sorts);

  useEffect(() => {
    sortsRef.current = sorts;
  }, [sorts]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const trimmed = query.trim();
    if (!trimmed && searchMatchedRows == null) {
      return undefined;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const baseRowCount = filterMatchedRows ?? totalRows;

    const timeout = window.setTimeout(async () => {
      try {
        const worker = getDataWorker();
        const activeSorts = sortsRef.current;

        if (!trimmed) {
          await worker.clearSearch({ requestId });
          if (requestId !== requestIdRef.current) {
            return;
          }

          if (activeSorts.length > 0) {
            await worker.applySorts({
              sorts: activeSorts,
              offset: 0,
              limit: 0,
              progressive: baseRowCount > PROGRESSIVE_SORT_THRESHOLD,
              visibleRows: PROGRESSIVE_VISIBLE_ROWS
            });
            if (requestId !== requestIdRef.current) {
              return;
            }
          }

          clearSearchResult();
          bumpViewVersion();
          return;
        }

        const response = await worker.globalSearch({
          requestId,
          query: trimmed,
          columns,
          caseSensitive: searchCaseSensitive
        });
        if (requestId !== requestIdRef.current) {
          return;
        }

        if (activeSorts.length > 0) {
          await worker.applySorts({
            sorts: activeSorts,
            offset: 0,
            limit: 0,
            progressive: response.matchedRows > PROGRESSIVE_SORT_THRESHOLD,
            visibleRows: PROGRESSIVE_VISIBLE_ROWS
          });
          if (requestId !== requestIdRef.current) {
            return;
          }
        }

        setSearchResult(response);
        bumpViewVersion();
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        reportAppError('Failed to perform global search', error, {
          operation: 'grid.search'
        });
      }
    }, trimmed ? SEARCH_DEBOUNCE_MS : 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    query,
    columns,
    enabled,
    totalRows,
    filterMatchedRows,
    searchMatchedRows,
    searchCaseSensitive,
    setSearchResult,
    clearSearchResult,
    bumpViewVersion
  ]);
};
