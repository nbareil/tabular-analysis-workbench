import { expose } from 'comlink';

import type { MaterializedRow } from './utils/materializeRowBatch';
import { RowIndexStore, findNearestCheckpoint } from './rowIndexStore';
import { groupMaterializedRows, normaliseGroupColumns } from './groupEngine';
import { RowBatchStore } from './rowBatchStore';
import type { GroupingRequest, GroupingResult } from './types';
import { logDebug } from '../utils/debugLog';
import { createDataWorkerState } from './state/dataWorkerState';
import { createIngestionPipeline } from './controllers/ingestionPipeline';
import { createFilterController } from './controllers/filterController';
import { createSortController } from './controllers/sortController';
import { createSearchController } from './controllers/searchController';
import { createTaggingController } from './controllers/taggingController';
import type {
  WorkerInitOptions,
  LoadFileRequest,
  LoadFileCallbacks,
  SeekRowsRequest,
  SeekRowsResult,
  ApplySortRequest,
  ApplySortResult,
  ApplyFilterRequest,
  ApplyFilterResult,
  FetchRowsRequest,
  FetchRowsResult,
  DataWorkerApi,
  SearchRequest,
  ClearSearchRequest,
  GlobalSearchResult,
  TaggingSnapshot,
  TagRowsRequest,
  TagRowsResponse,
  ExportTagsResponse,
  UpdateLabelRequest,
  DeleteLabelRequest,
  DeleteLabelResponse,
  ImportTagsRequest,
  LabelDefinition
} from './workerApiTypes';

export type {
  GroupingRequest,
  GroupingResult,
  TaggingSnapshot,
  TagRowsRequest,
  TagRowsResponse,
  ExportTagsResponse,
  UpdateLabelRequest,
  DeleteLabelRequest,
  DeleteLabelResponse,
  ImportTagsRequest,
  LabelDefinition,
  TagRecord
} from './types';


export const createDataWorkerApi = (): DataWorkerApi => {
  const state = createDataWorkerState();

  const ensureBatchStore = (): RowBatchStore => {
    if (!state.dataset.batchStore) {
      throw new Error('No dataset loaded');
    }

    return state.dataset.batchStore;
  };

  const getActiveRowOrder = (): Uint32Array | null => {
    return (
      state.dataset.sortedRowIds ?? state.dataset.searchRowIds ?? state.dataset.filterRowIds
    );
  };

  const getActiveRowCount = (): number => {
    const order = getActiveRowOrder();
    return order ? order.length : state.dataset.totalRows;
  };

  const buildRowIdWindow = (offset: number, limit?: number): number[] => {
    const order = getActiveRowOrder();
    const total = order ? order.length : state.dataset.totalRows;
    const start = Math.max(0, offset);
    const end = typeof limit === 'number' ? Math.min(total, start + Math.max(0, limit)) : total;

    if (start >= end) {
      return [];
    }

    if (order) {
      const rowIds: number[] = [];
      for (let index = start; index < end; index += 1) {
        const rowId = order[index];
        if (rowId != null) {
          rowIds.push(rowId);
        }
      }
      return rowIds;
    }

    const rowIds: number[] = [];
    for (let index = start; index < end; index += 1) {
      rowIds.push(index);
    }
    return rowIds;
  };

  const materializeViewWindow = async (offset: number, limit?: number): Promise<MaterializedRow[]> => {
    const rowIds = buildRowIdWindow(offset, limit);
    if (import.meta.env.DEV) {
      logDebug('data-worker', 'materializeViewWindow', {
        offset,
        limit,
        requested: rowIds.length,
        firstRowId: rowIds[0],
        lastRowId: rowIds[rowIds.length - 1],
        activeRowCount: getActiveRowCount()
      });
    }
    if (!rowIds.length) {
      return [];
    }

    const batchStore = ensureBatchStore();
    const rows = await batchStore.materializeRows(rowIds);
    if (import.meta.env.DEV) {
      logDebug('data-worker', 'materializeViewWindow resolved', {
        offset,
        limit,
        resolved: rows.length
      });
    }
    return rows;
  };

  const ingestionPipeline = createIngestionPipeline({ state });
  const filterController = createFilterController({
    state,
    materializeViewWindow
  });
  const sortController = createSortController({
    state,
    materializeViewWindow,
    getActiveRowCount
  });
  const searchController = createSearchController({
    state
  });
  const taggingController = createTaggingController(state);







  const api: DataWorkerApi = {
    async init(options) {
      const threshold = options.slowBatchThresholdMs;

      state.setOptions({
        chunkSize: options.chunkSize,
        debugLogging: options.debugLogging,
        slowBatchThresholdMs: threshold
      });

      await ingestionPipeline.init();
      filterController.init();
      sortController.init();
      searchController.init();
      taggingController.init();
    },
    async ping() {
      return 'pong';
    },
    async loadFile(request: LoadFileRequest, callbacks: LoadFileCallbacks) {
      filterController.clear();
      searchController.clear();
      sortController.clear();
      taggingController.clear();
      await ingestionPipeline.run(request, callbacks);
    },
    async loadRowIndex(handle) {
      return RowIndexStore.load(handle);
    },
    async seekRows({ handle, startRow, rowCount }) {
      const index = await RowIndexStore.load(handle);
      if (!index || rowCount <= 0) {
        return null;
      }

      const entries: Array<{ rowIndex: number; byteOffset: number }> = [];
      const endRow = startRow + rowCount;
      const startEntry = findNearestCheckpoint(index.entries, startRow);

      if (startEntry) {
        entries.push(startEntry);
      }

      for (const entry of index.entries) {
        if (entry.rowIndex > startRow && entry.rowIndex < endRow) {
          entries.push(entry);
        }
      }

      return {
        entries,
        checkpointInterval: index.checkpointInterval
      };
    },
    async applySorts(request: ApplySortRequest): Promise<ApplySortResult> {
      return sortController.run(request);
    },
    async applyFilter(request: ApplyFilterRequest): Promise<ApplyFilterResult> {
      return filterController.run(request);
    },
    async fetchRows({ offset, limit }: FetchRowsRequest): Promise<FetchRowsResult> {
      if (import.meta.env.DEV) {
        logDebug('data-worker', 'fetchRows request', {
          offset,
          limit,
          hasBatchStore: Boolean(state.dataset.batchStore),
          totalRows: state.dataset.totalRows,
          activeRowCount: getActiveRowCount()
        });
      }
      if (!state.dataset.batchStore) {
        if (import.meta.env.DEV) {
          console.warn('[data-worker] fetchRows received request before dataset ready');
        }
        return {
          rows: [],
          totalRows: 0,
          matchedRows: 0
        };
      }

      const rows = await materializeViewWindow(offset, limit);
      if (import.meta.env.DEV) {
        logDebug('data-worker', 'fetchRows resolved', {
          offset,
          limit,
          rows: rows.length,
          totalRows: state.dataset.totalRows,
          matchedRows: getActiveRowCount()
        });
      }
      return {
        rows,
        totalRows: state.dataset.totalRows,
        matchedRows: getActiveRowCount()
      };
    },
    async groupBy(request: GroupingRequest): Promise<GroupingResult> {
      const batchStore = state.dataset.batchStore;
      if (!batchStore) {
        return {
          groupBy: normaliseGroupColumns(request.groupBy),
          rows: [],
          totalGroups: 0,
          totalRows: 0
        };
      }

      const groupColumns = normaliseGroupColumns(request.groupBy);
      const normalisedRequest: GroupingRequest = {
        ...request,
        groupBy: groupColumns
      };

      const currentOrder = getActiveRowOrder();
      const collectedRows: MaterializedRow[] = [];

      if (currentOrder) {
        if (!currentOrder.length) {
          return {
            groupBy: groupColumns,
            rows: [],
            totalGroups: 0,
            totalRows: 0
          };
        }

        const idsArray = Array.from(currentOrder);
        const chunkSize = 10_000;
        for (let start = 0; start < idsArray.length; start += chunkSize) {
          const slice = idsArray.slice(start, start + chunkSize);
          const chunk = await batchStore.materializeRows(slice);
          collectedRows.push(...chunk);
        }
      } else {
        for await (const { rows } of batchStore.iterateMaterializedBatches()) {
          collectedRows.push(...rows);
        }
      }

      if (!collectedRows.length) {
        return {
          groupBy: groupColumns,
          rows: [],
          totalGroups: 0,
          totalRows: 0
        };
      }

      return groupMaterializedRows(collectedRows, state.dataset.columnTypes, normalisedRequest);
    },
    async globalSearch(request: SearchRequest): Promise<GlobalSearchResult> {
      return searchController.run(request);
    },
    async clearSearch(request?: ClearSearchRequest): Promise<void> {
      searchController.clearSearch(request);
    },
    async loadTags(): Promise<TaggingSnapshot> {
      return taggingController.loadTags();
    },
    async tagRows(request: TagRowsRequest): Promise<TagRowsResponse> {
      return taggingController.tagRows(request);
    },
    async clearTag(rowIds: number[]): Promise<TagRowsResponse> {
      return taggingController.clearTag(rowIds);
    },
    async updateLabel(request: UpdateLabelRequest): Promise<LabelDefinition> {
      return taggingController.updateLabel(request);
    },
    async deleteLabel(request: DeleteLabelRequest): Promise<DeleteLabelResponse> {
      return taggingController.deleteLabel(request);
    },
    async exportTags(): Promise<ExportTagsResponse> {
      return taggingController.exportTags();
    },
    async importTags(request: ImportTagsRequest): Promise<TaggingSnapshot> {
      return taggingController.importTags(request);
    },
    async persistTags(): Promise<void> {
      await taggingController.persistTags();
    }
  };
  return api;
};

const api = createDataWorkerApi();


expose(api);
