import { expose } from 'comlink';

import { groupRows } from './groupEngine';
import { profileColumn, timeHistogram } from './columnStats';
import { setDebugLoggingEnabled } from '../utils/debugLog';
import { serializeCsvRow } from '../utils/csvExport';
import { createDataWorkerState, type DataWorkerStateController } from './state/dataWorkerState';
import { createIngestionPipeline } from './controllers/ingestionPipeline';
import { activeRowOrder, createViewController, rowMaskFrom } from './controllers/viewController';
import { createTaggingController } from './controllers/taggingController';
import type {
  ColumnValueDistributionRequest,
  ColumnValueDistributionResult,
  DataWorkerApi,
  ExportCsvRequest
} from './workerApiTypes';

const CSV_MIME_TYPE = 'text/csv;charset=utf-8;';
// Columns with more distinct values than this share of rows are not worth listing in a picker.
const DISTRIBUTION_DISTINCT_RATIO_LIMIT = 0.5;

const computeValueDistribution = async (
  state: DataWorkerStateController,
  column: string
): Promise<ColumnValueDistributionResult> => {
  const dataset = state.dataset;
  const counts = new Map<string, number>();
  let nonNullRows = 0;
  for await (const view of dataset.batchStore!.iterateBatches()) {
    for (const value of view.column(column)) {
      if (value.trim() === '') {
        continue;
      }
      nonNullRows += 1;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  const totalRows = dataset.totalRows;
  const base = { column, totalRows, nonNullRows, distinctCount: counts.size };
  if (totalRows > 0 && counts.size / totalRows > DISTRIBUTION_DISTINCT_RATIO_LIMIT) {
    return { ...base, skipped: true, skipReason: 'Too many unique values', items: [] };
  }
  const items = Array.from(counts, ([value, count]) => ({ value, count })).sort(
    (left, right) => right.count - left.count || left.value.localeCompare(right.value)
  );
  return { ...base, skipped: false, items };
};

export const createDataWorkerApi = (): DataWorkerApi => {
  const state = createDataWorkerState();
  const ingestion = createIngestionPipeline(state);
  const view = createViewController(state);
  const tagging = createTaggingController(state);

  const viewRowIds = (offset: number, limit: number): ArrayLike<number> => {
    const order = activeRowOrder(state.dataset);
    const total = order ? order.length : state.dataset.totalRows;
    const start = Math.max(0, offset);
    const end = Math.min(total, start + Math.max(0, limit));
    if (order) {
      return order.subarray(start, Math.max(start, end));
    }
    return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  };

  const api: DataWorkerApi = {
    async init(options) {
      setDebugLoggingEnabled(Boolean(options.debugLogging));
      state.setOptions(options);
    },

    loadFile: (request, callbacks) => ingestion.run(request, callbacks),
    applyFilter: (request) => view.applyFilter(request),
    globalSearch: (request) => view.search(request),
    applySorts: (request) => view.applySorts(request),

    async fetchRows({ offset, limit }) {
      const dataset = state.dataset;
      const matchedRows = activeRowOrder(dataset)?.length ?? dataset.totalRows;
      if (!dataset.batchStore) {
        return { rows: [], totalRows: 0, matchedRows: 0 };
      }
      const rows = await dataset.batchStore.getRows(viewRowIds(offset, limit));
      return { rows, totalRows: dataset.totalRows, matchedRows };
    },

    async getRowsById(rowIds) {
      return state.dataset.batchStore?.getRows(rowIds) ?? [];
    },

    async getTimeHistogram({ column, buckets }) {
      const dataset = state.dataset;
      if (!dataset.batchStore || !dataset.header.includes(column)) {
        return { column, start: null, bucketMs: 0, counts: [], datedRows: 0 };
      }
      const mask = rowMaskFrom(dataset.searchRowIds ?? dataset.filterRowIds, dataset.totalRows);
      return timeHistogram(dataset.batchStore, mask, column, Math.max(1, Math.min(1_000, buckets)));
    },

    async profileColumn(column) {
      const dataset = state.dataset;
      if (!dataset.batchStore || !dataset.header.includes(column)) {
        throw new Error(`Unknown column "${column}"`);
      }
      const mask = rowMaskFrom(dataset.searchRowIds ?? dataset.filterRowIds, dataset.totalRows);
      return profileColumn(dataset.batchStore, mask, column, dataset.columnTypes[column] ?? 'string');
    },

    async findRowPosition(rowId) {
      const order = activeRowOrder(state.dataset);
      if (!order) {
        return rowId >= 0 && rowId < state.dataset.totalRows ? rowId : -1;
      }
      return order.indexOf(rowId);
    },

    async findTaggedPosition(fromPosition, direction) {
      const order = activeRowOrder(state.dataset);
      const total = order ? order.length : state.dataset.totalRows;
      const tags = state.tagging.tags;
      const step = direction === 'next' ? 1 : -1;
      for (let position = fromPosition + step; position >= 0 && position < total; position += step) {
        if (tags[order ? order[position]! : position]) {
          return position;
        }
      }
      return -1;
    },

    async getColumnValueDistribution({ column }: ColumnValueDistributionRequest) {
      const dataset = state.dataset;
      if (!dataset.batchStore || !dataset.header.includes(column)) {
        return { column, totalRows: dataset.totalRows, nonNullRows: 0, distinctCount: 0, skipped: false, items: [] };
      }
      // Distributions computed mid-load are partial, so only completed loads are cached.
      if (dataset.loading) {
        return computeValueDistribution(state, column);
      }
      let request = dataset.valueDistributions.get(column);
      if (!request) {
        request = computeValueDistribution(state, column);
        dataset.valueDistributions.set(column, request);
        request.catch(() => dataset.valueDistributions.delete(column));
      }
      return request;
    },

    groupBy: (request) =>
      state.runViewOperation('group', async (check) => {
        const dataset = state.dataset;
        if (!dataset.batchStore) {
          return { groupBy: [], rows: [], totalGroups: 0, totalRows: 0 };
        }
        const mask = rowMaskFrom(dataset.searchRowIds ?? dataset.filterRowIds, dataset.totalRows);
        return groupRows(dataset.batchStore, mask, dataset.columnTypes, request, check);
      }),

    async exportCsv({ columns, scope }: ExportCsvRequest) {
      const dataset = state.dataset;
      const store = dataset.batchStore;
      if (!store) {
        throw new Error('No dataset loaded');
      }
      const tags = state.tagging.tags;
      const labelNames = new Map(state.tagging.labels.map((label) => [label.id, label.name]));
      const order =
        scope === 'labelled'
          ? Uint32Array.from(
              Object.keys(tags)
                .map(Number)
                .sort((left, right) => left - right)
            )
          : (activeRowOrder(dataset) ?? Uint32Array.from({ length: dataset.totalRows }, (_, index) => index));

      const header = columns.map((column) => column.header);
      if (scope === 'labelled') {
        header.push('labels', 'note');
      }
      const parts: string[] = [serializeCsvRow(header)];
      const chunkSize = 10_000;
      for (let start = 0; start < order.length; start += chunkSize) {
        const rows = await store.getRows(order.subarray(start, start + chunkSize));
        let chunk = '';
        for (const row of rows) {
          const cells: unknown[] = columns.map((column) => row[column.key]);
          if (scope === 'labelled') {
            const record = tags[row.__rowId];
            cells.push(
              (record?.labelIds ?? []).map((id) => labelNames.get(id) ?? id).join('; '),
              record?.note ?? ''
            );
          }
          chunk += serializeCsvRow(cells);
        }
        parts.push(chunk);
      }
      return new Blob(parts, { type: CSV_MIME_TYPE });
    },

    loadTags: () => tagging.loadTags(),
    tagRows: (request) => tagging.tagRows(request),
    clearTag: (rowIds) => tagging.clearTag(rowIds),
    restoreTags: (records) => tagging.restoreTags(records),
    updateLabel: (request) => tagging.updateLabel(request),
    deleteLabel: (request) => tagging.deleteLabel(request),
    exportTags: () => tagging.exportTags(),
    importTags: (request) => tagging.importTags(request),
    persistTags: () => tagging.persistTags()
  };

  return api;
};

expose(createDataWorkerApi());
