import type { MaterializedRow } from './utils/materializeRowBatch';
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
import type { SearchRequest } from './searchEngine';
import type { FuzzyColumnSnapshot, FuzzyIndexSnapshot } from './fuzzyIndexStore';
import type { FuzzyMatchInfo } from './filterEngine';

export interface WorkerInitOptions {
  enableDuckDb?: boolean;
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
  metrics?: {
    fuzzyRowBuildMs: number;
    fuzzySnapshotMs: number;
  };
}

export interface GlobalSearchResult {
  rows: number[];
  totalRows: number;
  matchedRows: number;
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

export interface PersistFuzzyIndexRequest {
  createdAt?: number;
  rowCount: number;
  bytesParsed: number;
  tokenLimit: number;
  trigramSize: number;
  columns: FuzzyColumnSnapshot[];
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
  fuzzyUsed?: FuzzyMatchInfo;
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
  fetchRowsByIds: (rowIds: number[]) => Promise<MaterializedRow[]>;
  loadTags: () => Promise<TaggingSnapshot>;
  tagRows: (request: TagRowsRequest) => Promise<TagRowsResponse>;
  clearTag: (rowIds: number[]) => Promise<TagRowsResponse>;
  updateLabel: (request: UpdateLabelRequest) => Promise<LabelDefinition>;
  deleteLabel: (request: DeleteLabelRequest) => Promise<DeleteLabelResponse>;
  exportTags: () => Promise<ExportTagsResponse>;
  importTags: (request: ImportTagsRequest) => Promise<TaggingSnapshot>;
  getFuzzyIndexSnapshot: () => Promise<FuzzyIndexSnapshot | null>;
  persistFuzzyIndexSnapshot: (
    request: PersistFuzzyIndexRequest
  ) => Promise<FuzzyIndexSnapshot | null>;
  clearFuzzyIndexSnapshot: () => Promise<void>;
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

export type { FuzzyIndexSnapshot } from './fuzzyIndexStore';
