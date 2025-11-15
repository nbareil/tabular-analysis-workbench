import { useEffect, useMemo, useState } from 'react';

import type { FilterState } from '@state/sessionStore';
import type { GridColumn } from '@state/dataStore';
import { useDataStore } from '@state/dataStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import { useTagStore } from '@state/tagStore';
import {
  TAG_COLUMN_ID,
  TAG_NO_LABEL_FILTER_VALUE,
  type ColumnInference,
  type LabelDefinition
} from '@workers/types';

interface FilterBuilderProps {
  columns: GridColumn[];
}

const formatDatetimeForInput = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 16);
  }
  return '';
};

const smartParseDatetime = (value: string, isEnd: boolean = false): number | string => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  // Split into parts
  const parts = trimmed.split(/[-T:]/);
  let year = parts[0] || new Date().getFullYear().toString();
  let month = parts[1] || (isEnd ? '12' : '01');
  let day = parts[2] || (isEnd ? '31' : '01'); // Will adjust for month
  let hour = parts[3] || (isEnd ? '23' : '00');
  let minute = parts[4] || (isEnd ? '59' : '00');

  // Adjust day for month if necessary
  if (!parts[2]) {
    const date = new Date(parseInt(year), parseInt(month) - 1 + (isEnd ? 1 : 0), 0);
    if (isEnd) {
      day = date.getDate().toString().padStart(2, '0');
    }
  }

  // For year only, adjust month and day
  if (!parts[1]) {
    if (isEnd) {
      month = '12';
      day = '31';
    } else {
      month = '01';
      day = '01';
    }
  }

  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}Z`;
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
    fuzzy: false,
    fuzzyExplicit: isTagColumn,
    fuzzyDistanceExplicit: false,
    enabled: true
  };
};

const normaliseFilterForColumn = (
  filter: FilterState,
  labels: any
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
    fuzzy: false,
    fuzzyExplicit: true,
    fuzzyDistance: undefined,
    fuzzyDistanceExplicit: false,
    caseSensitive: false,
    enabled: filter.enabled ?? true
  };
};

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
  const tagLabels = useTagStore((state) => state.labels);
  const tagStatus = useTagStore((state) => state.status);
  const loadTags = useTagStore((state) => state.load);
  const [fuzzyWarning, setFuzzyWarning] = useState<string | null>(null);

  useEffect(() => {
    if (tagStatus === 'idle') {
      void loadTags();
    }
  }, [loadTags, tagStatus]);

  useEffect(() => {
    if (!fuzzyWarning) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setFuzzyWarning(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [fuzzyWarning]);

  const columnMap = useMemo(() => Object.fromEntries(columns.map(c => [c.key, c])), [columns]);

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

  const availableColumnValues = useMemo(
    () => availableColumns.map((entry) => entry.value),
    [availableColumns]
  );

  const handleAdd = () => {
    const newFilter = buildNewFilter({
      columns,
      columnInference,
      tagLabels
    });
    if (!newFilter) {
      return;
    }
    const next = [...filters, newFilter];
    void applyFilters(next);
  };

  const handleRemove = (id: string) => {
    const next = filters.filter((filter) => filter.id !== id);
    void applyFilters(next);
  };

  const handleChange = (id: string, updates: Partial<FilterState>) => {
    const next = filters.map((filter) => {
      if (filter.id !== id) {
        return filter;
      }

      const updated = { ...filter, ...updates };
      if (
        filter.column === TAG_COLUMN_ID &&
        updates.column &&
        updates.column !== TAG_COLUMN_ID
      ) {
        return {
          ...updated,
          operator: 'contains',
          value: '',
          value2: undefined,
          fuzzy: false,
          fuzzyExplicit: false,
          fuzzyDistance: undefined,
          fuzzyDistanceExplicit: false,
          caseSensitive: false
        };
      }

      if (updates.column && columnMap[updates.column]?.type === 'datetime' && updates.column !== TAG_COLUMN_ID) {
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
            updated.value2 = now + 86400000;
            updated.rawValue = formatDatetimeForInput(now);
            updated.rawValue2 = formatDatetimeForInput(now + 86400000);
          }
        }
      }

      if (updates.column === TAG_COLUMN_ID || updated.column === TAG_COLUMN_ID) {
        return normaliseFilterForColumn(updated, tagLabels);
      }

      if (updates.operator && updates.operator !== 'eq') {
        updated.fuzzy = false;
        updated.fuzzyExplicit = false;
        updated.fuzzyDistance = undefined;
        updated.fuzzyDistanceExplicit = false;
      }

      return updated;
    });
    void applyFilters(next);
  };

  const onDatetimeChange = (filter: FilterState, field: 'value' | 'value2') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const updates: Partial<FilterState> = { [`raw${field.charAt(0).toUpperCase() + field.slice(1)}`]: event.target.value };
    handleChange(filter.id, updates);
  };

  const onDatetimeBlur = (filter: FilterState, field: 'value' | 'value2') => (event: React.FocusEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const isEnd = field === 'value2';
    const parsed = smartParseDatetime(raw, isEnd);
    const updates: Partial<FilterState> = {
      [field]: parsed,
      [`raw${field.charAt(0).toUpperCase() + field.slice(1)}`]: typeof parsed === 'number' ? formatDatetimeForInput(parsed) : ''
    };
    if (field === 'value' && filter.operator === 'between' && typeof parsed === 'number') {
      const endParsed = smartParseDatetime(raw, true);
      updates.value2 = endParsed;
      updates.rawValue2 = typeof endParsed === 'number' ? formatDatetimeForInput(endParsed) : '';
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
          {fuzzyWarning && (
            <div className="rounded border border-yellow-600 bg-yellow-900/30 px-2 py-1 text-xs text-yellow-200">
              {fuzzyWarning}
            </div>
          )}
          {filters.map((filter) => {
            const matchCount = filterMatchCounts?.[filter.id];
            const isEnabled = filter.enabled !== false;
            const innerSectionClasses = isEnabled ? 'flex flex-col gap-2' : 'flex flex-col gap-2 opacity-60';
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
                    onChange={(event) => handleChange(filter.id, { enabled: event.target.checked })}
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
                  {availableColumns.map((column) => (
                    <option key={column.value} value={column.value}>
                      {column.label}
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
              <div className={`${columnMap[filter.column]?.type === 'datetime' && filter.operator === 'between' ? 'flex flex-col gap-1' : 'flex gap-2'} ${isEnabled ? '' : 'opacity-60'}`}>
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
              {columnMap[filter.column]?.type === 'datetime' && filter.operator === 'between' ? (
              <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-12">Start</span>
              <input
              type="text"
              className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
              value={filter.rawValue ?? formatDatetimeForInput(filter.value)}
              onChange={onDatetimeChange(filter, 'value')}
              onBlur={onDatetimeBlur(filter, 'value')}
              placeholder="YYYY-MM-DDTHH:MM"
              />
              </div>
              ) : columnMap[filter.column]?.type === 'datetime' ? (
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
              onChange={(event) => handleChange(filter.id, { value: event.target.value })}
              placeholder="Value"
              />
              )}
              </>
              )}
              {(filter.operator === 'between' || filter.operator === 'range') &&
              filter.column !== TAG_COLUMN_ID && (
              <>
              {columnMap[filter.column]?.type === 'datetime' && filter.operator === 'between' ? (
              <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-12">End</span>
              <input
              type="text"
              className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
              value={filter.rawValue2 ?? formatDatetimeForInput(filter.value2)}
              onChange={onDatetimeChange(filter, 'value2')}
              onBlur={onDatetimeBlur(filter, 'value2')}
              placeholder="YYYY-MM-DDTHH:MM"
              />
              </div>
              ) : columnMap[filter.column]?.type === 'datetime' ? (
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
              onChange={(event) => handleChange(filter.id, { value2: event.target.value })}
              placeholder="Value 2"
              />
              )}
              </>
              )}
              </div>
              <div className="flex items-center justify-between text-slate-500">
                {filter.column !== TAG_COLUMN_ID ? (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={Boolean(filter.fuzzy)}
                        onChange={(event) => {
                          const nextValue = event.target.checked;
                          const operatorSupportsFuzzy = filter.operator === 'eq';
                          if (nextValue && !operatorSupportsFuzzy) {
                            setFuzzyWarning('Fuzzy search only works with Equals predicates. Switch this filter to "equals" before enabling fuzzy matching.');
                            return;
                          }
                          handleChange(filter.id, {
                            fuzzy: nextValue,
                            fuzzyExplicit: true
                          });
                        }}
                      />
                      Fuzzy
                    </label>
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
