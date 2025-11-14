export type ColumnType = 'string' | 'number' | 'datetime' | 'boolean';
export type Delimiter = ',' | '\t' | ';';

export interface ParseStats {
  rowsParsed: number;
  bytesParsed: number;
  eof: boolean;
}

interface ColumnBatchBase<TType extends ColumnType> {
  type: TType;
  nullMask?: Uint8Array;
}

export interface StringColumnBatch extends ColumnBatchBase<'string'> {
  /** Concatenated UTF-8 encoded string data */
  data: ArrayBuffer;
  /**
   * Offsets into the {@link data} buffer.
   * The length is `rowCount + 1`, Apache Arrow style,
   * so offsets[i] - offsets[i - 1] is the byte-length of row i - 1.
   */
  offsets: Uint32Array;
}

export interface NumberColumnBatch extends ColumnBatchBase<'number'> {
  data: Float64Array;
}

export interface BooleanColumnBatch extends ColumnBatchBase<'boolean'> {
  data: Uint8Array;
}

export interface DatetimeColumnBatch extends ColumnBatchBase<'datetime'> {
  /** Milliseconds since epoch */
  data: Float64Array;
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
  fuzzy?: boolean;
}

export interface FilterExpression {
  op: 'and' | 'or';
  predicates: FilterNode[];
}

export type FilterNode = FilterPredicate | FilterExpression;

export type ColumnBatch =
  | StringColumnBatch
  | NumberColumnBatch
  | BooleanColumnBatch
  | DatetimeColumnBatch;

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
  labelId: string | null;
  note?: string;
  color?: string;
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
  labelId: string | null;
  note?: string;
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
}

export interface RowBatch {
  rowIds: Uint32Array;
  columns: Record<string, ColumnBatch>;
  columnTypes: Record<string, ColumnType>;
  columnInference: Record<string, ColumnInference>;
  stats: ParseStats;
}
