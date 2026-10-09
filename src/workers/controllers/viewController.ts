import { compileFilter, evaluateFilterOnBatch } from '../filterEngine';
import { suggestDidYouMean } from '../didYouMean';
import { sortRowIds } from '../sortEngine';
import type { DataWorkerStateController, DatasetState, SearchSpec } from '../state/dataWorkerState';
import type { RowBatchStore } from '../rowBatchStore';
import type { FilterNode, SortDefinition } from '../types';
import { normalizeString } from '../utils/stringUtils';
import { startPerformanceMeasure } from '../utils/performanceMarks';
import type {
  ApplyFilterRequest,
  ApplyFilterResult,
  ApplySortRequest,
  ApplySortResult,
  SearchRequest,
  ViewResult
} from '../workerApiTypes';

export const rowMaskFrom = (rowIds: Uint32Array | null, totalRows: number): Uint8Array | null => {
  if (!rowIds) {
    return null;
  }
  const mask = new Uint8Array(totalRows);
  for (const rowId of rowIds) {
    mask[rowId] = 1;
  }
  return mask;
};

export const activeRowOrder = (dataset: DatasetState): Uint32Array | null =>
  dataset.sortedRowIds ?? dataset.searchRowIds ?? dataset.filterRowIds;

const allRowIds = (totalRows: number): Uint32Array => {
  const rowIds = new Uint32Array(totalRows);
  for (let index = 0; index < totalRows; index += 1) {
    rowIds[index] = index;
  }
  return rowIds;
};

const runFilter = async (
  dataset: DatasetState,
  store: RowBatchStore,
  expression: FilterNode,
  tags: DataWorkerStateController['tagging']['tags'],
  check: () => void
) => {
  const compiled = compileFilter(expression, dataset.columnTypes);
  const predicateMatchCounts: Record<string, number> = {};
  const matched: number[] = [];
  for await (const view of store.iterateBatches()) {
    check();
    const mask = evaluateFilterOnBatch(compiled, view, tags, predicateMatchCounts);
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] === 1) {
        matched.push(view.rowStart + index);
      }
    }
  }
  const didYouMean = matched.length
    ? undefined
    : await suggestDidYouMean({ batchStore: store, expression, columnTypes: dataset.columnTypes, check });
  return { rowIds: Uint32Array.from(matched), predicateMatchCounts, didYouMean };
};

const runSearch = async (
  dataset: DatasetState,
  store: RowBatchStore,
  spec: SearchSpec,
  base: Uint32Array | null,
  check: () => void
): Promise<Uint32Array> => {
  const needle = normalizeString(spec.query, spec.caseSensitive);
  const columns = spec.columns.length
    ? spec.columns.filter((column) => dataset.header.includes(column))
    : dataset.header;
  const mask = rowMaskFrom(base, store.totalRows);
  const matched: number[] = [];
  for await (const view of store.iterateBatches()) {
    check();
    const values = columns.map((column) => view.column(column));
    for (let index = 0; index < view.rowCount; index += 1) {
      const rowId = view.rowStart + index;
      if (mask && mask[rowId] !== 1) {
        continue;
      }
      if (values.some((column) => normalizeString(column[index]!, spec.caseSensitive).includes(needle))) {
        matched.push(rowId);
      }
    }
  }
  return Uint32Array.from(matched);
};

const runSort = (
  dataset: DatasetState,
  store: RowBatchStore,
  sorts: SortDefinition[],
  base: Uint32Array | null,
  check: () => void
): Promise<Uint32Array> =>
  sortRowIds(store, base ?? allRowIds(store.totalRows), dataset.columnTypes, sorts, check);

const summarise = (dataset: DatasetState): ViewResult => ({
  totalRows: dataset.totalRows,
  matchedRows: activeRowOrder(dataset)?.length ?? dataset.totalRows
});

export interface ViewController {
  applyFilter(request: ApplyFilterRequest): Promise<ApplyFilterResult>;
  search(request: SearchRequest): Promise<ViewResult>;
  applySorts(request: ApplySortRequest): Promise<ApplySortResult>;
}

/**
 * Owns the filter → search → sort pipeline. Each operation recomputes its stage and every later
 * active stage, then commits them together so a cancelled operation never leaves a half-updated view.
 */
export const createViewController = (state: DataWorkerStateController): ViewController => {
  const applyFilter = ({ expression }: ApplyFilterRequest): Promise<ApplyFilterResult> =>
    state.runViewOperation('filter', async (check) => {
      const measure = startPerformanceMeasure('worker-filter');
      try {
        const dataset = state.dataset;
        const store = dataset.batchStore;
        if (!store) {
          return { totalRows: 0, matchedRows: 0 };
        }
        const filtered = expression ? await runFilter(dataset, store, expression, state.tagging.tags, check) : null;
        const filterRowIds = filtered?.rowIds ?? null;
        const searchRowIds = dataset.search
          ? await runSearch(dataset, store, dataset.search, filterRowIds, check)
          : null;
        const sortedRowIds = dataset.sorts.length
          ? await runSort(dataset, store, dataset.sorts, searchRowIds ?? filterRowIds, check)
          : null;
        check();
        Object.assign(dataset, { filterExpression: expression, filterRowIds, searchRowIds, sortedRowIds });
        return {
          ...summarise(dataset),
          didYouMean: filtered?.didYouMean,
          predicateMatchCounts: filtered?.predicateMatchCounts
        };
      } finally {
        measure?.();
      }
    });

  const search = ({ query, columns, caseSensitive }: SearchRequest): Promise<ViewResult> =>
    state.runViewOperation('search', async (check) => {
      const dataset = state.dataset;
      const store = dataset.batchStore;
      if (!store) {
        return { totalRows: 0, matchedRows: 0 };
      }
      const spec: SearchSpec | null = query.trim()
        ? { query: query.trim(), columns, caseSensitive: Boolean(caseSensitive) }
        : null;
      const searchRowIds = spec ? await runSearch(dataset, store, spec, dataset.filterRowIds, check) : null;
      const sortedRowIds = dataset.sorts.length
        ? await runSort(dataset, store, dataset.sorts, searchRowIds ?? dataset.filterRowIds, check)
        : null;
      check();
      Object.assign(dataset, { search: spec, searchRowIds, sortedRowIds });
      return summarise(dataset);
    });

  const applySorts = ({ sorts }: ApplySortRequest): Promise<ApplySortResult> =>
    state.runViewOperation('sort', async (check) => {
      const dataset = state.dataset;
      const store = dataset.batchStore;
      const validSorts = sorts.filter((sort) => dataset.header.includes(sort.column));
      if (!store) {
        return { totalRows: 0, matchedRows: 0, sorts: validSorts };
      }
      const sortedRowIds = validSorts.length
        ? await runSort(dataset, store, validSorts, dataset.searchRowIds ?? dataset.filterRowIds, check)
        : null;
      check();
      Object.assign(dataset, { sorts: validSorts, sortedRowIds });
      return { ...summarise(dataset), sorts: validSorts };
    });

  return { applyFilter, search, applySorts };
};
