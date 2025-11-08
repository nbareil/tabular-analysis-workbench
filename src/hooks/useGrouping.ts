import { useCallback, useEffect, useMemo } from 'react';

import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';
import { getDataWorker } from '@workers/dataWorkerProxy';
import type { GroupAggregationDefinition, GroupingResult } from '@workers/types';

type AggregateOperator = GroupAggregationDefinition['operator'];

const requiresColumn = (operator: AggregateOperator): boolean => operator !== 'count';

const defaultAlias = (aggregation: GroupAggregationDefinition): string => {
  if (aggregation.alias && aggregation.alias.trim().length > 0) {
    return aggregation.alias.trim();
  }

  const columnPart = aggregation.column ?? '*';
  return `${aggregation.operator}(${columnPart})`;
};

const normalizeAggregation = (
  aggregation: GroupAggregationDefinition
): GroupAggregationDefinition => {
  const alias = defaultAlias(aggregation);
  if (requiresColumn(aggregation.operator)) {
    if (aggregation.column) {
      return {
        operator: aggregation.operator,
        column: aggregation.column,
        alias
      };
    }

    return {
      operator: aggregation.operator,
      alias
    };
  }

  return {
    operator: aggregation.operator,
    alias
  };
};

const ensureAtLeastCount = (
  aggregations: GroupAggregationDefinition[]
): GroupAggregationDefinition[] => {
  if (aggregations.length > 0) {
    return aggregations;
  }

  return [
    {
      operator: 'count',
      alias: 'count'
    }
  ];
};

const serializeAggregations = (aggregations: GroupAggregationDefinition[]): string =>
  JSON.stringify(
    aggregations.map((aggregation) => ({
      operator: aggregation.operator,
      column: aggregation.column ?? null,
      alias: aggregation.alias ?? null
    }))
  );

export interface UseGroupingResult {
  groups: string[];
  aggregations: GroupAggregationDefinition[];
  grouping: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    rows: GroupingResult['rows'];
    groupBy: string[];
    totalGroups: number;
    totalRows: number;
    error: string | null;
  };
  toggleGroup: (column: string) => void;
  setGroups: (nextGroups: string[]) => void;
  updateAggregation: (
    index: number,
    updates: Partial<GroupAggregationDefinition>
  ) => void;
  addAggregation: (operator?: AggregateOperator) => void;
  removeAggregation: (index: number) => void;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing grouping state and operations.
 * Integrates with session store for persistence and data store for results.
 */
export const useGrouping = (): UseGroupingResult => {
  const groups = useSessionStore((state) => state.groups);
  const setGroups = useSessionStore((state) => state.setGroups);
  const aggregations = useSessionStore((state) => state.groupAggregations);
  const setGroupAggregations = useSessionStore((state) => state.setGroupAggregations);

  const columns = useDataStore((state) => state.columns);
  const loaderStatus = useDataStore((state) => state.status);
  const totalRows = useDataStore((state) => state.totalRows);
  const filterMatchedRows = useDataStore((state) => state.filterMatchedRows);
  const searchMatchedRows = useDataStore((state) => state.searchMatchedRows);
  const grouping = useDataStore((state) => state.grouping);
  const setGroupingLoading = useDataStore((state) => state.setGroupingLoading);
  const setGroupingResult = useDataStore((state) => state.setGroupingResult);
  const setGroupingError = useDataStore((state) => state.setGroupingError);
  const clearGrouping = useDataStore((state) => state.clearGrouping);

  const normalizedAggregations = useMemo(
    () => ensureAtLeastCount(aggregations.map(normalizeAggregation)),
    [aggregations]
  );

  const sanitizedAggregations = useMemo(() => {
    const valid = normalizedAggregations.filter((aggregation) => {
      if (!requiresColumn(aggregation.operator)) {
        return true;
      }

      return Boolean(aggregation.column);
    });

    return ensureAtLeastCount(valid);
  }, [normalizedAggregations]);

  const aggregationSignature = useMemo(
    () => serializeAggregations(sanitizedAggregations),
    [sanitizedAggregations]
  );

  const toggleGroup = useCallback(
    (column: string) => {
      const nextGroups = groups.includes(column)
        ? groups.filter((key) => key !== column)
        : [...groups, column];
      setGroups(nextGroups);
    },
    [groups, setGroups]
  );

  const addAggregation = useCallback(
    (operator: AggregateOperator = 'count') => {
      const next: GroupAggregationDefinition[] = [
        ...normalizedAggregations,
        normalizeAggregation({
          operator,
          column:
            operator === 'count'
              ? undefined
              : columns.find((column) => column.type === 'number')?.key ??
                columns[0]?.key,
          alias: undefined
        })
      ];
      setGroupAggregations(next);
    },
    [columns, normalizedAggregations, setGroupAggregations]
  );

  const removeAggregation = useCallback(
    (index: number) => {
      const next = normalizedAggregations.filter((_, position) => position !== index);
      setGroupAggregations(ensureAtLeastCount(next));
    },
    [normalizedAggregations, setGroupAggregations]
  );

  const updateAggregation = useCallback(
    (index: number, updates: Partial<GroupAggregationDefinition>) => {
      const next = normalizedAggregations.map((aggregation, position) => {
        if (position !== index) {
          return aggregation;
        }

        const updated: GroupAggregationDefinition = {
          ...aggregation,
          ...updates
        };

        if (updated.operator === 'count') {
          delete updated.column;
        }

        return normalizeAggregation(updated);
      });

      setGroupAggregations(ensureAtLeastCount(next));
    },
    [normalizedAggregations, setGroupAggregations]
  );

  const performRefresh = useCallback(async () => {
    if (!groups.length) {
      clearGrouping();
      return;
    }

    if (loaderStatus === 'loading') {
      return;
    }

    try {
      setGroupingLoading();
      const worker = getDataWorker();
      const result = await worker.groupBy({
        groupBy: groups,
        aggregations: sanitizedAggregations
      });
      setGroupingResult(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to compute grouping results';
      setGroupingError(message);
      console.error('Failed to compute grouping results', error);
    }
  }, [
    clearGrouping,
    groups,
    loaderStatus,
    sanitizedAggregations,
    setGroupingError,
    setGroupingLoading,
    setGroupingResult
  ]);

  useEffect(() => {
    if (!groups.length) {
      clearGrouping();
      return;
    }

    if (loaderStatus !== 'ready' && totalRows === 0) {
      return;
    }

    void performRefresh();
  }, [
    aggregationSignature,
    clearGrouping,
    filterMatchedRows,
    groups,
    loaderStatus,
    performRefresh,
    searchMatchedRows,
    totalRows
  ]);

  const refresh = useCallback(async () => {
    await performRefresh();
  }, [performRefresh]);

  return {
    groups,
    aggregations: normalizedAggregations,
    grouping,
    toggleGroup,
    setGroups,
    updateAggregation,
    addAggregation,
    removeAggregation,
    refresh
  };
};
