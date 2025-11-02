import { wrap, type Remote } from 'comlink';

import type {
  DataWorkerApi,
  LoadFileCallbacks,
  LoadFileRequest,
  SeekRowsRequest,
  SeekRowsResult,
  ApplySortRequest,
  ApplySortResult,
  ApplyFilterRequest,
  ApplyFilterResult,
  GroupingRequest,
  GroupingResult,
  TaggingSnapshot,
  TagRowsRequest,
  TagRowsResponse,
  ExportTagsResponse,
  UpdateLabelRequest,
  DeleteLabelRequest,
  ImportTagsRequest,
  LabelDefinition
} from './dataWorker.worker';

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

export type {
  LoadFileCallbacks,
  LoadFileRequest,
  SeekRowsRequest,
  SeekRowsResult,
  ApplySortRequest,
  ApplySortResult,
  ApplyFilterRequest,
  ApplyFilterResult,
  GroupingRequest,
  GroupingResult,
  TaggingSnapshot,
  TagRowsRequest,
  TagRowsResponse,
  ExportTagsResponse,
  UpdateLabelRequest,
  DeleteLabelRequest,
  ImportTagsRequest,
  LabelDefinition
};
