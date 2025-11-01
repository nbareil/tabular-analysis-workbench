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
  examples: string[];
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

export interface RowBatch {
  rowIds: Uint32Array;
  columns: Record<string, ColumnBatch>;
  columnTypes: Record<string, ColumnType>;
  columnInference: Record<string, ColumnInference>;
  stats: ParseStats;
}
