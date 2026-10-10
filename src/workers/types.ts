export type ColumnType = 'string' | 'number' | 'datetime' | 'boolean';
export type Delimiter = ',' | '\t' | ';' | '|';

export interface ParseStats {
  rowsParsed: number;
  bytesParsed: number;
  /** Rows whose field count did not match the header (padded or folded into the last column). */
  malformedRows: number;
  eof: boolean;
}

/** Raw cell text for one column of a batch, stored Apache Arrow style. */
export interface ColumnBatch {
  /** Concatenated UTF-8 encoded cell text */
  data: ArrayBuffer;
  /** One entry more than stored values; offsets[i + 1] - offsets[i] is the byte length of value i. */
  offsets: Uint32Array;
  /** Sparse columns only: the batch row of each stored value, ascending. Rows not listed are empty. */
  rows?: Uint32Array;
}

export interface ColumnInference {
  type: ColumnType;
  confidence: number;
  samples: number;
  nullCount: number;
  examples: readonly string[];
  minDatetime?: number;
  maxDatetime?: number;
}

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'startsWith'
  | 'regex'
  | 'matches'
  | 'notMatches'
  | 'range'
  | 'gt'
  | 'lt'
  | 'between';

export interface FilterPredicate {
  id?: string;
  column: string;
  operator: FilterOperator;
  value: unknown;
  value2?: unknown;
  caseSensitive?: boolean;
}

export interface FilterExpression {
  op: 'and' | 'or';
  predicates: FilterNode[];
}

export type FilterNode = FilterPredicate | FilterExpression;

export interface SortDefinition {
  column: string;
  direction: 'asc' | 'desc';
}

export type AggregateOperator = 'count' | 'sum' | 'min' | 'max' | 'avg';

export interface GroupAggregationDefinition {
  operator: AggregateOperator;
  column?: string;
  alias?: string;
}

export interface GroupingRequest {
  groupBy: string | string[];
  aggregations: GroupAggregationDefinition[];
  offset?: number;
  limit?: number;
}

export interface GroupingRow {
  key: unknown | unknown[];
  rowCount: number;
  aggregates: Record<string, unknown>;
}

export interface GroupingResult {
  groupBy: string[];
  rows: GroupingRow[];
  totalGroups: number;
  totalRows: number;
}

export interface LabelDefinition {
  id: string;
  name: string;
  color: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TagRecord {
  labelIds: string[];
  note?: string;
  updatedAt: number;
}

export interface TaggingSnapshot {
  labels: LabelDefinition[];
  tags: Record<number, TagRecord>;
}

export interface TagExportSource {
  fileName?: string | null;
  rowCount?: number;
}

export const TAG_EXPORT_VERSION = 1 as const;

export const TAG_COLUMN_ID = '__tag';
export const TAG_NO_LABEL_FILTER_VALUE = '__tag:none';

export interface TagRowsRequest {
  rowIds: number[];
  labelIds?: string[] | null;
  note?: string;
  mode?: 'replace' | 'append' | 'remove';
}

export interface TagRowsResponse {
  updated: Record<number, TagRecord>;
}

export interface UpdateLabelRequest {
  label: LabelDefinition;
}

export interface DeleteLabelRequest {
  labelId: string;
}

export interface DeleteLabelResponse {
  deleted: boolean;
  updated: Record<number, TagRecord>;
}

export interface ExportTagsResponse {
  version: number;
  exportedAt: number;
  source?: TagExportSource;
  payload: TaggingSnapshot;
}

export interface ImportTagsRequest {
  labels: LabelDefinition[];
  tags: Record<number, TagRecord>;
  mergeStrategy?: 'replace' | 'merge';
  /** Where the export came from; a row count that differs from the open file is rejected. */
  source?: TagExportSource;
}

export interface RowBatch {
  rowIds: Uint32Array;
  columns: Record<string, ColumnBatch>;
  columnTypes: Record<string, ColumnType>;
  columnInference: Record<string, ColumnInference>;
  stats: ParseStats;
}
