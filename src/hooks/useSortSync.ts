import { useCallback, useEffect, useRef } from 'react';

import { useDataStore, type GridRow } from '@state/dataStore';
import { useSessionStore, type SessionSnapshot } from '@state/sessionStore';
import { getDataWorker } from '@workers/dataWorkerProxy';
import { buildFilterExpression } from '@utils/filterExpression';

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
}

export interface UseSortSyncResult {
  sorts: SortState[];
  applySorts: (nextSorts: SortState[]) => Promise<void>;
  clearSorts: () => Promise<void>;
}

export const useSortSync = (): UseSortSyncResult => {
  const sorts = useSessionStore((state) => state.sorts);
  const setSorts = useSessionStore((state) => state.setSorts);
  const filters = useSessionStore((state) => state.filters);
  const setRows = useDataStore((state) => state.setRows);
  const setFilterResult = useDataStore((state) => state.setFilterResult);
  const clearFilterResult = useDataStore((state) => state.clearFilterResult);
  const totalRows = useDataStore((state) => state.totalRows);
  const bootstrapAppliedRef = useRef(false);

  const applySortsInternal = useCallback(
    async (nextSorts: SortState[], options: ApplyOptions = {}): Promise<SortState[]> => {
      const { persist = true } = options;

      try {
        const worker = getDataWorker();
        const response = await worker.applySorts({
          sorts: nextSorts,
          offset: 0
        });

        setRows(response.rows as GridRow[]);
        bootstrapAppliedRef.current = true;

        try {
          if (filters.length > 0) {
            const expression = buildFilterExpression(filters);
            if (expression) {
              const filterResponse = await worker.applyFilter({
                expression,
                offset: 0,
                limit: 500
              });
              setFilterResult({
                rows: filterResponse.rows as GridRow[],
                totalRows: filterResponse.totalRows,
                matchedRows: filterResponse.matchedRows
              });
            } else {
              clearFilterResult();
            }
          } else {
            clearFilterResult();
          }
        } catch (error) {
          console.error('Failed to refresh filtered rows after sort', error);
        }

        if (persist) {
          setSorts(response.sorts);
        }

        return response.sorts;
      } catch (error) {
        console.error('Failed to apply sorts', error);
        throw error;
      }
    },
    [clearFilterResult, filters, setFilterResult, setRows, setSorts]
  );

  const applySorts = useCallback(
    async (nextSorts: SortState[]) => {
      await applySortsInternal(nextSorts, { persist: true });
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

