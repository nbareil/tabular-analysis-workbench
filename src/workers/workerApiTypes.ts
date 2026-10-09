import type { MaterializedRow } from './rowBatchStore';
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
  ImportTagsRequest,
  TagRecord
} from './types';

export type { MaterializedRow };

export interface WorkerInitOptions {
  debugLogging?: boolean;
  slowBatchThresholdMs?: number;
}

export interface LoadFileRequest {
  /** One file, or several to merge into one timeline with a `source_file` column. */
  handles: FileSystemFileHandle[];
  delimiter?: Delimiter;
  batchSize?: number;
  encoding?: string;
}

export interface LoadProgress {
  rowsParsed: number;
  bytesParsed: number;
  batchesStored: number;
  columnTypes: Record<string, ColumnType>;
}

export interface LoadCompleteSummary {
  rowsParsed: number;
  bytesParsed: number;
  malformedRows: number;
  durationMs: number;
  columnTypes: Record<string, ColumnType>;
  columnInference: Record<string, ColumnInference>;
}

export interface LoadFileCallbacks {
  onStart?: (payload: { columns: string[] }) => void | Promise<void>;
  onProgress?: (progress: LoadProgress) => void | Promise<void>;
  onComplete?: (summary: LoadCompleteSummary) => void | Promise<void>;
  onError?: (error: { message: string; name?: string; stack?: string }) => void | Promise<void>;
}

/** Row counts of the current view after a filter, search or sort. */
export interface ViewResult {
  totalRows: number;
  matchedRows: number;
}

export interface SearchRequest {
  query: string;
  columns: string[];
  caseSensitive?: boolean;
}

export interface ApplySortRequest {
  sorts: SortDefinition[];
}

export interface ApplySortResult extends ViewResult {
  sorts: SortDefinition[];
}

export interface ApplyFilterRequest {
  expression: FilterNode | null;
}

export interface ApplyFilterResult extends ViewResult {
  didYouMean?: DidYouMeanInfo;
  predicateMatchCounts?: Record<string, number>;
}

export interface ColumnValueDistributionRequest {
  column: string;
}

export interface ColumnValueDistributionItem {
  value: string;
  count: number;
}

export interface ColumnValueDistributionResult {
  column: string;
  totalRows: number;
  nonNullRows: number;
  distinctCount: number;
  skipped: boolean;
  skipReason?: string;
  items: ColumnValueDistributionItem[];
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

export interface ExportCsvRequest {
  columns: Array<{ key: string; header: string }>;
  /** `view` exports the current filtered/searched/sorted rows; `labelled` only rows with labels or notes. */
  scope: 'view' | 'labelled';
}

export interface TimeHistogramRequest {
  column: string;
  buckets: number;
}

export interface TimeHistogramResult {
  column: string;
  /** Epoch milliseconds of the first bucket's start; null when no value parsed. */
  start: number | null;
  bucketMs: number;
  counts: number[];
  /** Rows in the view whose value parsed as a datetime. */
  datedRows: number;
}

export interface ColumnProfile {
  column: string;
  type: ColumnType;
  rows: number;
  emptyCount: number;
  /** Values that did not parse as the column type (always 0 for text columns). */
  invalidCount: number;
  distinctCount: number;
  /** True when distinct counting stopped at its cap, so distinctCount is a lower bound. */
  distinctCapped: boolean;
  min: string | null;
  max: string | null;
  mean: number | null;
  minLength: number;
  maxLength: number;
  topValues: ColumnValueDistributionItem[];
}

export interface DataWorkerApi {
  init: (options: WorkerInitOptions) => Promise<void>;
  loadFile: (request: LoadFileRequest, callbacks: LoadFileCallbacks) => Promise<void>;
  applySorts: (request: ApplySortRequest) => Promise<ApplySortResult>;
  applyFilter: (request: ApplyFilterRequest) => Promise<ApplyFilterResult>;
  globalSearch: (request: SearchRequest) => Promise<ViewResult>;
  getColumnValueDistribution: (
    request: ColumnValueDistributionRequest
  ) => Promise<ColumnValueDistributionResult>;
  fetchRows: (request: FetchRowsRequest) => Promise<FetchRowsResult>;
  getRowsById: (rowIds: number[]) => Promise<MaterializedRow[]>;
  getTimeHistogram: (request: TimeHistogramRequest) => Promise<TimeHistogramResult>;
  profileColumn: (column: string) => Promise<ColumnProfile>;
  /** Position of a row id in the current view, or -1 when the view excludes it. */
  findRowPosition: (rowId: number) => Promise<number>;
  /** View position of the nearest labelled or annotated row after/before `fromPosition`, or -1. */
  findTaggedPosition: (fromPosition: number, direction: 'next' | 'previous') => Promise<number>;
  /** Sets rows' tag records verbatim (null removes the record); used to undo label edits. */
  restoreTags: (records: Record<number, TagRecord | null>) => Promise<TagRowsResponse>;
  groupBy: (request: GroupingRequest) => Promise<GroupingResult>;
  exportCsv: (request: ExportCsvRequest) => Promise<Blob>;
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
};
