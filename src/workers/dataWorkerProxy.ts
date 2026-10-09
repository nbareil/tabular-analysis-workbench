import { wrap, type Remote } from 'comlink';

import type { DataWorkerApi } from './workerApiTypes';

let workerInstance: Remote<DataWorkerApi> | null = null;

export const getDataWorker = (): Remote<DataWorkerApi> => {
  if (!workerInstance) {
    workerInstance = wrap<DataWorkerApi>(
      new Worker(new URL('./dataWorker.worker.ts', import.meta.url), {
        type: 'module'
      })
    );
  }

  return workerInstance;
};

export type DataWorkerRemote = Remote<DataWorkerApi>;

/** The worker rejects superseded requests with this error; callers should silently drop them. */
export const isStaleOperation = (error: unknown): boolean =>
  (error as { name?: unknown } | null)?.name === 'StaleOperationError';

export type {
  LoadFileCallbacks,
  LoadFileRequest,
  ApplySortRequest,
  ApplySortResult,
  ApplyFilterRequest,
  ApplyFilterResult,
  ColumnValueDistributionRequest,
  ColumnValueDistributionResult,
  FetchRowsRequest,
  FetchRowsResult,
  SearchRequest,
  ViewResult,
  ExportCsvRequest,
  LoadProgress,
  GroupingRequest,
  GroupingResult,
  TaggingSnapshot,
  TagRowsRequest,
  TagRowsResponse,
  ExportTagsResponse,
  UpdateLabelRequest,
  DeleteLabelRequest,
  ImportTagsRequest,
  LabelDefinition,
  LoadCompleteSummary,
  MaterializedRow,
  TimeHistogramResult,
  ColumnProfile
} from './workerApiTypes';
