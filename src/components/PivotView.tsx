import { useCallback, useMemo } from 'react';

import { useDataStore } from '@state/dataStore';
import type { GridColumn } from '@state/dataStore';
import type { GroupAggregationDefinition } from '@workers/types';
import { useGrouping } from '@/hooks/useGrouping';

const operatorOptions: Array<{
  value: GroupAggregationDefinition['operator'];
  label: string;
  requiresColumn: boolean;
}> = [
  { value: 'count', label: 'Count', requiresColumn: false },
  { value: 'sum', label: 'Sum', requiresColumn: true },
  { value: 'min', label: 'Min', requiresColumn: true },
  { value: 'max', label: 'Max', requiresColumn: true },
  { value: 'avg', label: 'Average', requiresColumn: true }
];

const requiresColumn = (
  operator: GroupAggregationDefinition['operator']
): boolean => operator !== 'count';

const findDefaultColumn = (columns: GridColumn[], operator: GroupAggregationDefinition['operator']): string | undefined => {
  if (!requiresColumn(operator)) {
    return undefined;
  }

  if (operator === 'sum' || operator === 'avg') {
    const numericColumn = columns.find((column) => column.type === 'number');
    if (numericColumn) {
      return numericColumn.key;
    }
  }

  return columns[0]?.key;
};

const formatValue = (value: unknown): string => {
  if (value == null) {
    return '—';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
};

const PivotView = (): JSX.Element => {
  const columns = useDataStore((state) => state.columns);
  const {
    groups,
    aggregations,
    grouping,
    toggleGroup,
    setGroups,
    updateAggregation,
    addAggregation,
    removeAggregation,
    refresh
  } = useGrouping();

  const columnLookup = useMemo<Record<string, GridColumn | undefined>>(() => {
    return columns.reduce<Record<string, GridColumn | undefined>>((accumulator, column) => {
      accumulator[column.key] = column;
      return accumulator;
    }, {});
  }, [columns]);

  const invalidAggregations = useMemo(
    () =>
      aggregations
        .map((aggregation, index) => ({ aggregation, index }))
        .filter(
          ({ aggregation }) => requiresColumn(aggregation.operator) && !aggregation.column
        ),
    [aggregations]
  );

  const groupHeaders = useMemo(
    () =>
      grouping.groupBy.map((columnKey) => columnLookup[columnKey]?.headerName ?? columnKey),
    [grouping.groupBy, columnLookup]
  );

  const aggregateHeaders = useMemo(
    () => aggregations.map((aggregation) => aggregation.alias ?? ''),
    [aggregations]
  );

  const handleOperatorChange = useCallback(
    (index: number, operator: GroupAggregationDefinition['operator']) => {
      const nextColumn =
        requiresColumn(operator) && !aggregations[index]?.column
          ? findDefaultColumn(columns, operator)
          : aggregations[index]?.column;

      updateAggregation(index, {
        operator,
        column: nextColumn
      });
    },
    [aggregations, columns, updateAggregation]
  );

  const handleAliasChange = useCallback(
    (index: number, alias: string) => {
      updateAggregation(index, { alias });
    },
    [updateAggregation]
  );

  const handleColumnChange = useCallback(
    (index: number, column: string) => {
      updateAggregation(index, { column });
    },
    [updateAggregation]
  );

  const handleClearGroups = useCallback(() => {
    setGroups([]);
  }, [setGroups]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded border border-slate-800 p-4">
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Group columns</h2>
            <div className="flex gap-2 text-xs">
              <span className="text-slate-500">
                {groups.length > 0
                  ? `${groups.length} selected`
                  : 'Select one or more columns'}
              </span>
              {groups.length > 0 && (
                <button
                  type="button"
                  className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
                  onClick={handleClearGroups}
                >
                  Clear
                </button>
              )}
            </div>
          </header>
          <div className="max-h-64 space-y-2 overflow-auto pr-1 text-sm text-slate-300">
            {columns.length === 0 && (
              <p className="text-xs text-slate-500">Columns load after a file is opened.</p>
            )}
            {columns.map((column) => (
              <label
                key={column.key}
                className="flex items-center justify-between gap-2 rounded border border-transparent px-2 py-1 hover:border-slate-700 hover:bg-slate-900"
              >
                <span>
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={groups.includes(column.key)}
                    onChange={() => toggleGroup(column.key)}
                  />
                  {column.headerName}
                </span>
                <span className="text-xs uppercase text-slate-500">{column.type}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="rounded border border-slate-800 p-4">
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Aggregations</h2>
            <button
              type="button"
              className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
              onClick={() => addAggregation('count')}
            >
              Add metric
            </button>
          </header>
          <div className="space-y-3 text-sm text-slate-200">
            {aggregations.map((aggregation, index) => (
              <div
                key={`${aggregation.operator}:${index}`}
                className="rounded border border-slate-700 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200"
                    value={aggregation.operator}
                    onChange={(event) =>
                      handleOperatorChange(
                        index,
                        event.target.value as GroupAggregationDefinition['operator']
                      )
                    }
                  >
                    {operatorOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {requiresColumn(aggregation.operator) && (
                    <select
                      className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200"
                      value={aggregation.column ?? ''}
                      onChange={(event) => handleColumnChange(index, event.target.value)}
                    >
                      <option value="">Select column…</option>
                      {columns.map((column) => (
                        <option key={column.key} value={column.key}>
                          {column.headerName}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="text"
                    className="min-w-[120px] flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200"
                    value={aggregation.alias ?? ''}
                    onChange={(event) => handleAliasChange(index, event.target.value)}
                    placeholder="Alias"
                  />
                  <button
                    type="button"
                    className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:bg-red-900/40 hover:border-red-700 disabled:opacity-40"
                    onClick={() => removeAggregation(index)}
                    disabled={aggregations.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          {invalidAggregations.length > 0 && (
            <p className="mt-3 text-xs text-amber-400">
              Select a column for {invalidAggregations.length === 1 ? 'this metric' : 'these metrics'} to include it in the pivot results.
            </p>
          )}
        </section>
      </div>
      <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-400">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-4">
          <span>
            Status:{' '}
            <span className="font-semibold text-slate-200">
              {grouping.status === 'idle' && 'Idle'}
              {grouping.status === 'loading' && 'Computing…'}
              {grouping.status === 'ready' && 'Ready'}
              {grouping.status === 'error' && 'Error'}
            </span>
          </span>
          {grouping.status === 'ready' && (
            <span>
              {grouping.totalGroups.toLocaleString()} groups •{' '}
              {grouping.totalRows.toLocaleString()} rows
            </span>
          )}
          {grouping.status === 'error' && grouping.error && (
            <span className="text-red-400">{grouping.error}</span>
          )}
        </div>
        <button
          type="button"
          className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          onClick={() => refresh()}
          disabled={!groups.length}
        >
          Refresh
        </button>
      </div>
      <div className="flex-1 overflow-auto rounded border border-slate-800">
        {groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Select at least one group column to see pivot results.
          </div>
        ) : grouping.status === 'loading' ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Computing grouping aggregates…
          </div>
        ) : grouping.status === 'error' ? (
          <div className="flex h-full items-center justify-center text-sm text-red-400">
            {grouping.error ?? 'Grouping failed. Try again.'}
          </div>
        ) : grouping.rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            No groups found for the current selection.
          </div>
        ) : (
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400">
                {groupHeaders.map((header) => (
                  <th key={`group-${header}`} className="border-b border-slate-700 px-3 py-2">
                    {header}
                  </th>
                ))}
                {aggregateHeaders.map((header) => (
                  <th key={`agg-${header}`} className="border-b border-slate-700 px-3 py-2">
                    {header}
                  </th>
                ))}
                <th className="border-b border-slate-700 px-3 py-2">Rows</th>
              </tr>
            </thead>
            <tbody>
              {grouping.rows.map((row, rowIndex) => {
                const keyValues = Array.isArray(row.key) ? row.key : [row.key];
                return (
                  <tr
                    key={`pivot-row-${rowIndex}`}
                    className={rowIndex % 2 === 0 ? 'bg-slate-950' : 'bg-slate-900/60'}
                  >
                    {keyValues.map((value, index) => (
                      <td key={`key-${index}`} className="border-b border-slate-800 px-3 py-2">
                        {formatValue(value)}
                      </td>
                    ))}
                    {aggregateHeaders.map((alias) => (
                      <td key={`agg-${alias}`} className="border-b border-slate-800 px-3 py-2">
                        {formatValue(row.aggregates[alias])}
                      </td>
                    ))}
                    <td className="border-b border-slate-800 px-3 py-2">
                      {row.rowCount.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PivotView;
