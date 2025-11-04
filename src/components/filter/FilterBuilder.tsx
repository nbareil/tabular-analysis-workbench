import { useEffect, useMemo } from 'react';

import type { FilterState } from '@state/sessionStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import { useTagStore } from '@state/tagStore';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from '@workers/types';

interface FilterBuilderProps {
  columns: string[];
}

const defaultFilter = (columns: string[], labels: ReturnType<typeof useTagStore>['labels']): FilterState => {
  const column = columns[0] ?? '';
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
  labels: ReturnType<typeof useTagStore>['labels']
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

  const availableColumns = useMemo(() => {
    const datasetColumns = columns.filter(Boolean).map((column) => ({
      value: column,
      label: column
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
    const next = [...filters, defaultFilter(availableColumnValues, tagLabels)];
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

      if (updates.column === TAG_COLUMN_ID || updated.column === TAG_COLUMN_ID) {
        return normaliseFilterForColumn(updated, tagLabels);
      }

      return updated;
    });
    void applyFilters(next);
  };

  if (columns.length === 0) {
    return (
      <div className="rounded border border-slate-700 p-3 text-sm text-slate-500">
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
          className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200"
          onClick={handleAdd}
        >
          Add Filter
        </button>
      </div>
      {filters.length === 0 ? (
        <div className="rounded border border-dashed border-slate-700 p-3 text-xs text-slate-500">
          No filters applied. Add one to narrow results.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filters.map((filter) => (
            <div
              key={filter.id}
              className="flex flex-col gap-2 rounded border border-slate-700 p-3 text-xs text-slate-300"
            >
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1"
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
                  className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1"
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
              <div className="flex gap-2">
                {filter.column === TAG_COLUMN_ID ? (
                  <select
                    className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1"
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
                  <input
                    className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1"
                    value={String(filter.value ?? '')}
                    onChange={(event) => handleChange(filter.id, { value: event.target.value })}
                    placeholder="Value"
                  />
                )}
                {(filter.operator === 'between' || filter.operator === 'range') &&
                  filter.column !== TAG_COLUMN_ID && (
                  <input
                    className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1"
                    value={String(filter.value2 ?? '')}
                    onChange={(event) => handleChange(filter.id, { value2: event.target.value })}
                    placeholder="Value 2"
                  />
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
                  className="rounded border border-slate-600 px-2 py-1 text-xs text-red-300"
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
