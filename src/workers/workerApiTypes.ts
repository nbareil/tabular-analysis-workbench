import type { MaterializedRow } from './utils/materializeRowBatch';
import type { DidYouMeanInfo } from './didYouMean';
import type {
  ColumnInference,
  ColumnType,
  Delimiter,
  FilterNode,
  GroupingRequest,
  GroupingResult,
  LabelDefinition,
  SortDefinition,
  TaggingSnapshot,
  TagRowsRequest,
  TagRowsResponse,
  ExportTagsResponse,
  UpdateLabelRequest,
  DeleteLabelRequest,
  DeleteLabelResponse,
  ImportTagsRequest
} from './types';
import type { RowIndexData } from './rowIndexStore';

export interface WorkerInitOptions {
  chunkSize?: number;
  debugLogging?: boolean;
  slowBatchThresholdMs?: number;
}

export interface LoadFileRequest {
  handle: FileSystemFileHandle;
  delimiter?: Delimiter;
  batchSize?: number;
  encoding?: string;
  checkpointInterval?: number;
}

export interface LoadCompleteSummary {
  rowsParsed: number;
  bytesParsed: number;
  durationMs: number;
  columnTypes: Record<string, ColumnType>;
  columnInference: Record<string, ColumnInference>;
}

export interface SearchRequest {
  requestId?: number;
  query: string;
  columns: string[];
  caseSensitive?: boolean;
}

export interface ClearSearchRequest {
  requestId?: number;
}

export interface GlobalSearchResult {
  totalRows: number;
  matchedRows: number;
}

export type EventTimelineBucketFamily = 'seconds' | 'minutes' | 'hours';

export interface EventTimelineBucket {
  start: number;
  end: number;
  count: number;
}

export interface EventTimelineRequest {
  requestId?: number;
  column: string;
  expression: FilterNode | null;
  rangeStart: number;
  rangeEnd: number;
  selectedStart?: number | null;
  selectedEnd?: number | null;
}

export interface EventTimelineResult {
  requestId?: number;
  column: string;
  rangeStart: number;
  rangeEnd: number;
  selectedStart: number | null;
  selectedEnd: number | null;
  bucketFamily: EventTimelineBucketFamily;
  bucketStep: number;
  totalMatchingRows: number;
  buckets: EventTimelineBucket[];
}

export interface LoadFileCallbacks {
  onStart?: (payload: { columns: string[] }) => void | Promise<void>;
  onProgress?: (progress: { rowsParsed: number; bytesParsed: number; batchesStored: number }) => void | Promise<void>;
  onComplete?: (summary: LoadCompleteSummary) => void | Promise<void>;
  onError?: (error: { message: string; name?: string; stack?: string }) => void | Promise<void>;
}

export interface SeekRowsRequest {
  handle: FileSystemFileHandle;
  startRow: number;
  rowCount: number;
}

export interface SeekRowsResult {
  entries: Array<{ rowIndex: number; byteOffset: number }>;
  checkpointInterval: number;
}

export interface ApplySortRequest {
  sorts: SortDefinition[];
  offset?: number;
  limit?: number;
  progressive?: boolean;
  visibleRows?: number;
}

export interface ApplySortResult {
  rows: MaterializedRow[];
  totalRows: number;
  matchedRows: number;
  sorts: SortDefinition[];
  sortComplete?: boolean;
  sortedRowCount?: number;
}

export interface ApplyFilterRequest {
  expression: FilterNode | null;
  offset?: number;
  limit?: number;
}

export interface ApplyFilterResult {
  rows: MaterializedRow[];
  totalRows: number;
  matchedRows: number;
  expression: FilterNode | null;
  didYouMean?: DidYouMeanInfo;
  predicateMatchCounts?: Record<string, number>;
}

export interface FetchRowsRequest {
  offset: number;
  limit: number;
}

export interface FetchRowsResult {
  rows: MaterializedRow[];
  totalRows: number;
  matchedRows: number;
}

export interface DataWorkerApi {
  init: (options: WorkerInitOptions) => Promise<void>;
  ping: () => Promise<string>;
  loadFile: (request: LoadFileRequest, callbacks: LoadFileCallbacks) => Promise<void>;
  loadRowIndex: (handle: FileSystemFileHandle) => Promise<RowIndexData | null>;
  seekRows: (request: SeekRowsRequest) => Promise<SeekRowsResult | null>;
  applySorts: (request: ApplySortRequest) => Promise<ApplySortResult>;
  applyFilter: (request: ApplyFilterRequest) => Promise<ApplyFilterResult>;
  fetchRows: (request: FetchRowsRequest) => Promise<FetchRowsResult>;
  groupBy: (request: GroupingRequest) => Promise<GroupingResult>;
  globalSearch: (request: SearchRequest) => Promise<GlobalSearchResult>;
  getEventTimeline: (request: EventTimelineRequest) => Promise<EventTimelineResult>;
  clearSearch: (request?: ClearSearchRequest) => Promise<void>;
  loadTags: () => Promise<TaggingSnapshot>;
  tagRows: (request: TagRowsRequest) => Promise<TagRowsResponse>;
  clearTag: (rowIds: number[]) => Promise<TagRowsResponse>;
  updateLabel: (request: UpdateLabelRequest) => Promise<LabelDefinition>;
  deleteLabel: (request: DeleteLabelRequest) => Promise<DeleteLabelResponse>;
  exportTags: () => Promise<ExportTagsResponse>;
  importTags: (request: ImportTagsRequest) => Promise<TaggingSnapshot>;
  persistTags: () => Promise<void>;
}

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
  LabelDefinition
} from './types';
