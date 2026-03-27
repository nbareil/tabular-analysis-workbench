import { useEffect, useMemo, useState } from 'react';

import { useFilterSync } from '@/hooks/useFilterSync';
import { useDataStore, type GridColumn } from '@state/dataStore';
import type { FilterState } from '@state/sessionStore';
import { useTagStore } from '@state/tagStore';
import { reportAppError } from '@utils/diagnostics';
import { getDataWorker } from '@workers/dataWorkerProxy';
import {
  TAG_COLUMN_ID,
  TAG_NO_LABEL_FILTER_VALUE,
  type ColumnInference,
  type LabelDefinition
} from '@workers/types';

interface FilterBuilderProps {
  columns: GridColumn[];
}

type DistributionSortOrder = 'asc' | 'desc';

const DISTRIBUTION_SUPPORTED_TYPES = new Set<GridColumn['type']>(['string', 'boolean']);
const DISTRIBUTION_SUPPORTED_OPERATORS = new Set(['eq', 'neq']);

const formatDatetimeForInput = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 16);
  }
  return '';
};

const smartParseDatetime = (value: string, isEnd = false): number | string => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const parts = trimmed.split(/[-T:]/);
  const year = parts[0] || new Date().getFullYear().toString();
  let month = parts[1] || (isEnd ? '12' : '01');
  let day = parts[2] || (isEnd ? '31' : '01');
  const hour = parts[3] || (isEnd ? '23' : '00');
  const minute = parts[4] || (isEnd ? '59' : '00');

  if (!parts[2]) {
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1 + (isEnd ? 1 : 0), 0);
    if (isEnd) {
      day = date.getDate().toString().padStart(2, '0');
    }
  }

  if (!parts[1]) {
    month = isEnd ? '12' : '01';
    day = isEnd ? '31' : '01';
  }

  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(
    2,
    '0'
  )}:${minute.padStart(2, '0')}Z`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? timestamp : '';
};

const defaultFilter = (column: string, labels: LabelDefinition[]): FilterState => {
  const isTagColumn = column === TAG_COLUMN_ID;
  return {
    id: crypto.randomUUID(),
    column,
    operator: isTagColumn ? 'eq' : 'contains',
    value: isTagColumn ? (labels[0]?.id ?? TAG_NO_LABEL_FILTER_VALUE) : '',
    caseSensitive: false,
    enabled: true
  };
};

const normaliseFilterForColumn = (
  filter: FilterState,
  labels: LabelDefinition[]
): FilterState => {
  if (filter.column !== TAG_COLUMN_ID) {
    return filter;
  }

  const value =
    typeof filter.value === 'string' && filter.value.length > 0
      ? filter.value
      : labels[0]?.id ?? TAG_NO_LABEL_FILTER_VALUE;

  const operator = filter.operator === 'neq' ? 'neq' : 'eq';

  return {
    ...filter,
    operator,
    value,
    value2: undefined,
    caseSensitive: false,
    enabled: filter.enabled ?? true
  };
};

const supportsValueDistribution = (
  filter: FilterState,
  column?: GridColumn
): boolean =>
  filter.column !== TAG_COLUMN_ID &&
  column != null &&
  DISTRIBUTION_SUPPORTED_TYPES.has(column.type) &&
  DISTRIBUTION_SUPPORTED_OPERATORS.has(filter.operator);

const sortDistributionItems = (
  items: Array<{ value: string; count: number }>,
  direction: DistributionSortOrder
): Array<{ value: string; count: number }> =>
  [...items].sort((left, right) => {
    if (left.count !== right.count) {
      return direction === 'asc' ? left.count - right.count : right.count - left.count;
    }

    return left.value.localeCompare(right.value);
  });

interface BuildFilterParams {
  columns: GridColumn[];
  columnInference: Record<string, ColumnInference>;
  tagLabels: LabelDefinition[];
}

export const buildNewFilter = ({
  columns,
  columnInference,
  tagLabels
}: BuildFilterParams): FilterState | null => {
  if (!columns.length) {
    return null;
  }

  const firstColumn =
    columns.find((column) => column.key !== TAG_COLUMN_ID) ?? columns[0] ?? null;
  if (!firstColumn) {
    return null;
  }

  const newFilter = defaultFilter(firstColumn.key, tagLabels);
  if (firstColumn.type === 'datetime' && firstColumn.key !== TAG_COLUMN_ID) {
    newFilter.operator = 'between';
    const inference = columnInference[firstColumn.key];
    const minDatetime = inference?.minDatetime;
    const maxDatetime = inference?.maxDatetime;
    if (minDatetime != null && maxDatetime != null) {
      newFilter.value = minDatetime;
      newFilter.value2 = maxDatetime;
      newFilter.rawValue = formatDatetimeForInput(minDatetime);
      newFilter.rawValue2 = formatDatetimeForInput(maxDatetime);
    } else {
      const now = Date.now();
      newFilter.value = now;
      newFilter.value2 = now + 86_400_000;
      newFilter.rawValue = formatDatetimeForInput(now);
      newFilter.rawValue2 = formatDatetimeForInput(now + 86_400_000);
    }
  }

  return newFilter;
};

const FilterBuilder = ({ columns }: FilterBuilderProps): JSX.Element => {
  const { filters, applyFilters } = useFilterSync();
  const columnInference = useDataStore((state) => state.columnInference);
  const filterMatchCounts = useDataStore((state) => state.filterPredicateMatchCounts);
  const loaderStatus = useDataStore((state) => state.status);
  const columnValueDistributions = useDataStore((state) => state.columnValueDistributions);
  const setColumnValueDistributionLoading = useDataStore(
    (state) => state.setColumnValueDistributionLoading
  );
  const setColumnValueDistributionResult = useDataStore(
    (state) => state.setColumnValueDistributionResult
  );
  const setColumnValueDistributionError = useDataStore(
    (state) => state.setColumnValueDistributionError
  );
  const tagLabels = useTagStore((state) => state.labels);
  const tagStatus = useTagStore((state) => state.status);
  const loadTags = useTagStore((state) => state.load);
  const [distributionSort, setDistributionSort] = useState<
    Record<string, DistributionSortOrder>
  >({});

  useEffect(() => {
    if (tagStatus === 'idle') {
      void loadTags();
    }
  }, [loadTags, tagStatus]);

  const columnMap = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.key, column])),
    [columns]
  );

  const availableColumns = useMemo(() => {
    const datasetColumns = columns.map((column) => ({
      value: column.key,
      label: column.headerName || column.key
    }));

    return [
      ...datasetColumns,
      {
        value: TAG_COLUMN_ID,
        label: 'Label'
      }
    ];
  }, [columns]);

  const loadColumnValueDistribution = async (column: string) => {
    setColumnValueDistributionLoading(column);

    try {
      const worker = getDataWorker();
      const result = await worker.getColumnValueDistribution({ column });
      setColumnValueDistributionResult(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load column value distribution';
      setColumnValueDistributionError(column, message);
      reportAppError('Failed to load column value distribution', error, {
        operation: 'filters.columnValueDistribution',
        context: { column },
        retry: () => loadColumnValueDistribution(column)
      });
    }
  };

  useEffect(() => {
    if (loaderStatus !== 'ready') {
      return;
    }

    const columnsToLoad = new Set<string>();

    for (const filter of filters) {
      const column = columnMap[filter.column];
      if (supportsValueDistribution(filter, column)) {
        columnsToLoad.add(filter.column);
      }
    }

    for (const column of columnsToLoad) {
      if (columnValueDistributions[column] == null) {
        void loadColumnValueDistribution(column);
      }
    }
  }, [columnMap, columnValueDistributions, filters, loaderStatus]);

  const handleAdd = () => {
    const newFilter = buildNewFilter({
      columns,
      columnInference,
      tagLabels
    });
    if (!newFilter) {
      return;
    }
    void applyFilters([...filters, newFilter]);
  };

  const handleRemove = (id: string) => {
    void applyFilters(filters.filter((filter) => filter.id !== id));
  };

  const handleChange = (id: string, updates: Partial<FilterState>) => {
    const next = filters.map((filter) => {
      if (filter.id !== id) {
        return filter;
      }

      const updated = { ...filter, ...updates };

      if (filter.column === TAG_COLUMN_ID && updates.column && updates.column !== TAG_COLUMN_ID) {
        return {
          ...updated,
          operator: 'contains',
          value: '',
          value2: undefined,
          caseSensitive: false
        };
      }

      if (
        updates.column &&
        columnMap[updates.column]?.type === 'datetime' &&
        updates.column !== TAG_COLUMN_ID
      ) {
        updated.operator = 'between';
        if (!updated.value) {
          const inference = columnInference[updates.column];
          const minDatetime = inference?.minDatetime;
          const maxDatetime = inference?.maxDatetime;
          if (minDatetime != null && maxDatetime != null) {
            updated.value = minDatetime;
            updated.value2 = maxDatetime;
            updated.rawValue = formatDatetimeForInput(minDatetime);
            updated.rawValue2 = formatDatetimeForInput(maxDatetime);
          } else {
            const now = Date.now();
            updated.value = now;
            updated.value2 = now + 86_400_000;
            updated.rawValue = formatDatetimeForInput(now);
            updated.rawValue2 = formatDatetimeForInput(now + 86_400_000);
          }
        }
      }

      if (updates.column === TAG_COLUMN_ID || updated.column === TAG_COLUMN_ID) {
        return normaliseFilterForColumn(updated, tagLabels);
      }

      return updated;
    });

    void applyFilters(next);
  };

  const onDatetimeChange =
    (filter: FilterState, field: 'value' | 'value2') =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const updates: Partial<FilterState> = {
        [`raw${field.charAt(0).toUpperCase() + field.slice(1)}`]: event.target.value
      };
      handleChange(filter.id, updates);
    };

  const onDatetimeBlur =
    (filter: FilterState, field: 'value' | 'value2') =>
    (event: React.FocusEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      const isEnd = field === 'value2';
      const parsed = smartParseDatetime(raw, isEnd);
      const updates: Partial<FilterState> = {
        [field]: parsed,
        [`raw${field.charAt(0).toUpperCase() + field.slice(1)}`]:
          typeof parsed === 'number' ? formatDatetimeForInput(parsed) : ''
      };
      if (field === 'value' && filter.operator === 'between' && typeof parsed === 'number') {
        const endParsed = smartParseDatetime(raw, true);
        updates.value2 = endParsed;
        updates.rawValue2 =
          typeof endParsed === 'number' ? formatDatetimeForInput(endParsed) : '';
      }
      handleChange(filter.id, updates);
    };

  if (columns.length === 0) {
    return (
      <div className="rounded border border-slate-700 p-2 text-sm text-slate-500">
        Load a dataset to configure filters.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Filters</h2>
        <button
          type="button"
          className="rounded border border-slate-600 px-1 py-0.5 text-xs text-slate-200"
          onClick={handleAdd}
        >
          Add Filter
        </button>
      </div>
      {filters.length === 0 ? (
        <div className="rounded border border-dashed border-slate-700 p-2 text-xs text-slate-500">
          No filters applied. Add one to narrow results.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filters.map((filter) => {
            const matchCount = filterMatchCounts?.[filter.id];
            const isEnabled = filter.enabled !== false;
            const innerSectionClasses = isEnabled
              ? 'flex flex-col gap-2'
              : 'flex flex-col gap-2 opacity-60';
            const column = columnMap[filter.column];
            const showValueDistribution = supportsValueDistribution(filter, column);
            const distributionEntry = columnValueDistributions[filter.column];
            const distributionResult = distributionEntry?.result;
            const sortOrder =
              distributionSort[filter.id] ?? distributionResult?.defaultSort ?? 'desc';
            const sortedItems = distributionResult
              ? sortDistributionItems(distributionResult.items, sortOrder)
              : [];

            return (
              <div
                key={filter.id}
                className="flex flex-col gap-2 rounded border border-slate-700 p-2 text-xs text-slate-300"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-slate-500">
                  <label className="flex items-center gap-1 text-slate-300">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(event) =>
                        handleChange(filter.id, { enabled: event.target.checked })
                      }
                    />
                    Enabled
                  </label>
                  <span className="text-slate-500">
                    {isEnabled
                      ? matchCount != null
                        ? `Matches ${matchCount.toLocaleString()} rows`
                        : 'Awaiting results'
                      : 'Filter disabled'}
                  </span>
                </div>
                <div className={innerSectionClasses}>
                  <select
                    className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                    value={filter.column}
                    onChange={(event) => handleChange(filter.id, { column: event.target.value })}
                  >
                    {availableColumns.map((availableColumn) => (
                      <option key={availableColumn.value} value={availableColumn.value}>
                        {availableColumn.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                    value={filter.operator}
                    onChange={(event) => handleChange(filter.id, { operator: event.target.value })}
                  >
                    {filter.column === TAG_COLUMN_ID ? (
                      <>
                        <option value="eq">equals</option>
                        <option value="neq">not equals</option>
                      </>
                    ) : (
                      <>
                        <option value="contains">contains</option>
                        <option value="eq">equals</option>
                        <option value="neq">not equals</option>
                        <option value="startsWith">starts with</option>
                        <option value="matches">matches regex</option>
                        <option value="notMatches">not matches regex</option>
                        <option value="gt">greater than</option>
                        <option value="lt">less than</option>
                        <option value="between">between</option>
                      </>
                    )}
                  </select>
                </div>
                <div
                  className={`${
                    column?.type === 'datetime' && filter.operator === 'between'
                      ? 'flex flex-col gap-1'
                      : 'flex gap-2'
                  } ${isEnabled ? '' : 'opacity-60'}`}
                >
                  {filter.column === TAG_COLUMN_ID ? (
                    <select
                      className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                      value={
                        typeof filter.value === 'string' && filter.value.length > 0
                          ? filter.value
                          : TAG_NO_LABEL_FILTER_VALUE
                      }
                      onChange={(event) => handleChange(filter.id, { value: event.target.value })}
                    >
                      <option value={TAG_NO_LABEL_FILTER_VALUE}>No label</option>
                      {tagLabels.map((label) => (
                        <option key={label.id} value={label.id}>
                          {label.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      {column?.type === 'datetime' && filter.operator === 'between' ? (
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-xs text-slate-400">Start</span>
                          <input
                            type="text"
                            className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                            value={filter.rawValue ?? formatDatetimeForInput(filter.value)}
                            onChange={onDatetimeChange(filter, 'value')}
                            onBlur={onDatetimeBlur(filter, 'value')}
                            placeholder="YYYY-MM-DDTHH:MM"
                          />
                        </div>
                      ) : column?.type === 'datetime' ? (
                        <input
                          type="text"
                          className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                          value={filter.rawValue ?? formatDatetimeForInput(filter.value)}
                          onChange={onDatetimeChange(filter, 'value')}
                          onBlur={onDatetimeBlur(filter, 'value')}
                          placeholder="YYYY-MM-DDTHH:MM"
                        />
                      ) : (
                        <input
                          className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                          value={String(filter.value ?? '')}
                          onChange={(event) =>
                            handleChange(filter.id, { value: event.target.value })
                          }
                          placeholder="Value"
                        />
                      )}
                    </>
                  )}
                  {(filter.operator === 'between' || filter.operator === 'range') &&
                    filter.column !== TAG_COLUMN_ID && (
                      <>
                        {column?.type === 'datetime' && filter.operator === 'between' ? (
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-xs text-slate-400">End</span>
                            <input
                              type="text"
                              className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                              value={filter.rawValue2 ?? formatDatetimeForInput(filter.value2)}
                              onChange={onDatetimeChange(filter, 'value2')}
                              onBlur={onDatetimeBlur(filter, 'value2')}
                              placeholder="YYYY-MM-DDTHH:MM"
                            />
                          </div>
                        ) : column?.type === 'datetime' ? (
                          <input
                            type="text"
                            className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                            value={filter.rawValue2 ?? formatDatetimeForInput(filter.value2)}
                            onChange={onDatetimeChange(filter, 'value2')}
                            onBlur={onDatetimeBlur(filter, 'value2')}
                            placeholder="YYYY-MM-DDTHH:MM"
                          />
                        ) : (
                          <input
                            className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                            value={String(filter.value2 ?? '')}
                            onChange={(event) =>
                              handleChange(filter.id, { value2: event.target.value })
                            }
                            placeholder="Value 2"
                          />
                        )}
                      </>
                    )}
                </div>
                {showValueDistribution && (
                  <div className={`${isEnabled ? '' : 'opacity-60'} rounded border border-slate-800 bg-slate-950/70 p-2`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">
                        Value counts
                      </span>
                      <button
                        type="button"
                        className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300"
                        onClick={() =>
                          setDistributionSort((current) => ({
                            ...current,
                            [filter.id]: sortOrder === 'desc' ? 'asc' : 'desc'
                          }))
                        }
                      >
                        {sortOrder === 'desc' ? 'Most common' : 'Least common'}
                      </button>
                    </div>
                    {distributionEntry?.status === 'loading' && (
                      <p className="text-xs text-slate-500">Loading value counts…</p>
                    )}
                    {distributionEntry?.status === 'error' && (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-amber-400">
                          {distributionEntry.error ?? 'Failed to load value counts'}
                        </p>
                        <button
                          type="button"
                          className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300"
                          onClick={() => void loadColumnValueDistribution(filter.column)}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    {distributionEntry?.status === 'ready' &&
                      distributionResult?.skipped && (
                        <p className="text-xs text-slate-500">
                          {distributionResult.skipReason ?? 'Too many unique values'}
                        </p>
                      )}
                    {distributionEntry?.status === 'ready' &&
                      !distributionResult?.skipped &&
                      sortedItems.length === 0 && (
                        <p className="text-xs text-slate-500">No repeated values found.</p>
                      )}
                    {distributionEntry?.status === 'ready' &&
                      !distributionResult?.skipped &&
                      sortedItems.length > 0 && (
                        <div className="max-h-40 space-y-1 overflow-auto">
                          {sortedItems.map((item) => {
                            const selected = String(filter.value ?? '') === item.value;
                            return (
                              <button
                                key={`${filter.column}:${item.value}`}
                                type="button"
                                className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left ${
                                  selected
                                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-100'
                                    : 'border-slate-800 bg-slate-900 text-slate-200 hover:border-slate-700 hover:bg-slate-800'
                                }`}
                                onClick={() => handleChange(filter.id, { value: item.value })}
                              >
                                <span className="truncate pr-3">{item.value || '(empty string)'}</span>
                                <span className="shrink-0 text-[10px] text-slate-400">
                                  {item.count.toLocaleString()}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                  </div>
                )}
                <div className="flex items-center justify-between text-slate-500">
                  {filter.column !== TAG_COLUMN_ID ? (
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={Boolean(filter.caseSensitive)}
                          onChange={(event) =>
                            handleChange(filter.id, { caseSensitive: event.target.checked })
                          }
                        />
                        Case sensitive
                      </label>
                    </div>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-slate-600">
                      Label filters use exact match
                    </span>
                  )}
                  <button
                    type="button"
                    className="rounded border border-slate-600 px-1 py-0.5 text-xs text-red-300"
                    onClick={() => handleRemove(filter.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FilterBuilder;
