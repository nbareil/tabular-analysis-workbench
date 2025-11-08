import { useEffect, useMemo } from 'react';

import type { FilterState } from '@state/sessionStore';
import type { GridColumn } from '@state/dataStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import { useTagStore } from '@state/tagStore';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from '@workers/types';

interface FilterBuilderProps {
  columns: GridColumn[];
}

const formatDatetimeForInput = (value: unknown): string => {
  const date = typeof value === 'number' && Number.isFinite(value) ? new Date(value) : new Date();
  // Format as UTC ISO string for datetime-local input
  return date.toISOString().slice(0, 16);
};

const parseDatetimeFromInput = (value: string): number | string => {
  if (value) {
    // Treat the input as UTC by appending 'Z'
    const timestamp = Date.parse(value + 'Z');
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  return '';
};

const defaultFilter = (column: string, labels: any): FilterState => {
  const isTagColumn = column === TAG_COLUMN_ID;
  return {
    id: crypto.randomUUID(),
    column,
    operator: isTagColumn ? 'eq' : 'contains',
    value: isTagColumn ? (labels[0]?.id ?? TAG_NO_LABEL_FILTER_VALUE) : '',
    caseSensitive: false,
    fuzzy: false
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
    caseSensitive: false
  };
};

const FilterBuilder = ({ columns }: FilterBuilderProps): JSX.Element => {
  const { filters, applyFilters } = useFilterSync();
  const tagLabels = useTagStore((state) => state.labels);
  const tagStatus = useTagStore((state) => state.status);
  const loadTags = useTagStore((state) => state.load);

  useEffect(() => {
    if (tagStatus === 'idle') {
      void loadTags();
    }
  }, [loadTags, tagStatus]);

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
    const firstColumn = columns.find(c => c.key !== TAG_COLUMN_ID)?.key || '';
    const newFilter = defaultFilter(firstColumn, tagLabels);
    const columnType = columnMap[firstColumn]?.type;
    if (columnType === 'datetime' && firstColumn !== TAG_COLUMN_ID) {
      newFilter.operator = 'between';
      newFilter.value = Date.now();
      newFilter.value2 = Date.now();
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
          caseSensitive: false
        };
      }

      if (updates.column && columnMap[updates.column]?.type === 'datetime' && updates.column !== TAG_COLUMN_ID) {
        updated.operator = 'between';
      }

      if (updates.column === TAG_COLUMN_ID || updated.column === TAG_COLUMN_ID) {
        return normaliseFilterForColumn(updated, tagLabels);
      }

      return updated;
    });
    void applyFilters(next);
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
          {filters.map((filter) => (
            <div
            key={filter.id}
            className="flex flex-col gap-2 rounded border border-slate-700 p-2 text-xs text-slate-300"
            >
              <div className="flex flex-col gap-2">
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
              <div className={columnMap[filter.column]?.type === 'datetime' && filter.operator === 'between' ? 'flex flex-col gap-1' : 'flex gap-2'}>
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
                    type="datetime-local"
                    className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                    value={formatDatetimeForInput(filter.value)}
                  onChange={(event) => handleChange(filter.id, { value: parseDatetimeFromInput(event.target.value) })}
                placeholder="Date/Time"
                />
                </div>
              ) : columnMap[filter.column]?.type === 'datetime' ? (
                <input
                  type="datetime-local"
                className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
              value={formatDatetimeForInput(filter.value)}
              onChange={(event) => handleChange(filter.id, { value: parseDatetimeFromInput(event.target.value) })}
              placeholder="Date/Time"
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
                  type="datetime-local"
              className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
              value={formatDatetimeForInput(filter.value2)}
              onChange={(event) => handleChange(filter.id, { value2: parseDatetimeFromInput(event.target.value) })}
              placeholder="End Date/Time"
              />
              </div>
              ) : columnMap[filter.column]?.type === 'datetime' ? (
              <input
                  type="datetime-local"
                  className="flex-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
                  value={formatDatetimeForInput(filter.value2)}
                  onChange={(event) => handleChange(filter.id, { value2: parseDatetimeFromInput(event.target.value) })}
                  placeholder="End Date/Time"
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
                        onChange={(event) => handleChange(filter.id, { fuzzy: event.target.checked })}
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
          ))}
        </div>
      )}
    </div>
  );
};

export default FilterBuilder;
