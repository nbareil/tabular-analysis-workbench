import { useMemo } from 'react';

import type { FilterState } from '@state/sessionStore';
import { useFilterSync } from '@/hooks/useFilterSync';

interface FilterBuilderProps {
  columns: string[];
}

const defaultFilter = (columns: string[]): FilterState => ({
  id: crypto.randomUUID(),
  column: columns[0] ?? '',
  operator: 'contains',
  value: '',
  caseSensitive: false
});

const FilterBuilder = ({ columns }: FilterBuilderProps): JSX.Element => {
  const { filters, applyFilters } = useFilterSync();

  const availableColumns = useMemo(() => columns.filter(Boolean), [columns]);

  const handleAdd = () => {
    const next = [...filters, defaultFilter(availableColumns)];
    void applyFilters(next);
  };

  const handleRemove = (id: string) => {
    const next = filters.filter((filter) => filter.id !== id);
    void applyFilters(next);
  };

  const handleChange = (id: string, updates: Partial<FilterState>) => {
    const next = filters.map((filter) => (filter.id === id ? { ...filter, ...updates } : filter));
    void applyFilters(next);
  };

  if (availableColumns.length === 0) {
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
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
                <select
                  className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1"
                  value={filter.operator}
                  onChange={(event) => handleChange(filter.id, { operator: event.target.value })}
                >
                  <option value="contains">contains</option>
                  <option value="eq">equals</option>
                  <option value="neq">not equals</option>
                  <option value="startsWith">starts with</option>
                  <option value="matches">matches regex</option>
                  <option value="notMatches">not matches regex</option>
                  <option value="gt">greater than</option>
                  <option value="lt">less than</option>
                  <option value="between">between</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1"
                  value={String(filter.value ?? '')}
                  onChange={(event) => handleChange(filter.id, { value: event.target.value })}
                  placeholder="Value"
                />
                {(filter.operator === 'between' || filter.operator === 'range') && (
                  <input
                    className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1"
                    value={String(filter.value2 ?? '')}
                    onChange={(event) => handleChange(filter.id, { value2: event.target.value })}
                    placeholder="Value 2"
                  />
                )}
              </div>
              <div className="flex items-center justify-between text-slate-500">
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
