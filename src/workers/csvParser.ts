import type {
  BooleanColumnBatch,
  ColumnBatch,
  ColumnInference,
  ColumnType,
  DatetimeColumnBatch,
  Delimiter,
  NumberColumnBatch,
  RowBatch,
  StringColumnBatch
} from './types';
import { TypeInferencer, analyzeValue } from './typeInference';
import type { FuzzyIndexBuilder } from './fuzzyIndexBuilder';

export interface ParserOptions {
  delimiter?: Delimiter;
  batchSize?: number;
  encoding?: string;
  checkpointInterval?: number;
  fuzzyIndexBuilder?: FuzzyIndexBuilder;
}

export interface ParserCallbacks {
  onHeader?: (header: string[]) => void | Promise<void>;
  onBatch: (batch: RowBatch) => void | Promise<void>;
  onCheckpoint?: (payload: { rowIndex: number; byteOffset: number }) => void | Promise<void>;
}

export interface ParserMetrics {
  fuzzyRowBuildMs: number;
}

const DEFAULT_BATCH_SIZE = 10_000;

interface InternalState {
  header: string[] | null;
  delimiter: Delimiter;
  delimiterResolved: boolean;
  commaCount: number;
  tabCount: number;
  semicolonCount: number;
  inQuotes: boolean;
  quoteEscapePending: boolean;
  skipNextLF: boolean;
  fieldBuffer: string;
  currentRow: string[];
  columnBuilders: string[][];
  pendingRowCount: number;
  totalRows: number;
  totalBytes: number;
  inferencer: TypeInferencer | null;
  currentRowStartOffset: number;
  fuzzyRowBuildMs: number;
}

const createInitialState = (): InternalState => ({
  header: null,
  delimiter: ',',
  delimiterResolved: false,
  commaCount: 0,
  tabCount: 0,
  semicolonCount: 0,
  inQuotes: false,
  quoteEscapePending: false,
  skipNextLF: false,
  fieldBuffer: '',
  currentRow: [],
  columnBuilders: [],
  pendingRowCount: 0,
  totalRows: 0,
  totalBytes: 0,
  inferencer: null,
  currentRowStartOffset: 0,
  fuzzyRowBuildMs: 0
});

const timestamp = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const resetColumnBuilders = (state: InternalState): void => {
  state.columnBuilders = state.header ? state.header.map(() => []) : [];
  state.pendingRowCount = 0;
};

const ensureColumnBuilders = (state: InternalState): void => {
  if (!state.header) {
    return;
  }
  if (state.columnBuilders.length !== state.header.length) {
    resetColumnBuilders(state);
  }
};

const textEncoder = new TextEncoder();

const utf8ByteLength = (codePoint: number): number => {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
};

const createStringColumnBatch = (values: string[]): StringColumnBatch => {
  const encodedValues: Uint8Array[] = new Array(values.length);
  const offsets = new Uint32Array(values.length + 1);
  let byteOffset = 0;

  for (let index = 0; index < values.length; index += 1) {
    const encoded = textEncoder.encode(values[index] ?? '');
    encodedValues[index] = encoded;
    byteOffset += encoded.byteLength;
    offsets[index + 1] = byteOffset;
  }

  const buffer = new ArrayBuffer(offsets.byteLength + byteOffset);
  const offsetsView = new Uint32Array(buffer, 0, offsets.length);
  offsetsView.set(offsets);
  const dataView = new Uint8Array(buffer, offsets.byteLength);

  let writeOffset = 0;
  for (const encoded of encodedValues) {
    dataView.set(encoded, writeOffset);
    writeOffset += encoded.byteLength;
  }

  return {
    type: 'string',
    data: buffer,
    offsets: offsetsView
  };
};

const createBooleanColumnBatch = (values: string[]): BooleanColumnBatch => {
  const data = new Uint8Array(values.length);
  const nullMask = new Uint8Array(values.length);
  let hasNull = false;

  for (let index = 0; index < values.length; index += 1) {
    const analysis = analyzeValue(values[index] ?? '');
    if (analysis.kind === 'null') {
      nullMask[index] = 1;
      hasNull = true;
      continue;
    }

    if (analysis.kind === 'boolean') {
      data[index] = analysis.booleanValue ? 1 : 0;
    } else {
      nullMask[index] = 1;
      hasNull = true;
    }
  }

  return {
    type: 'boolean',
    data,
    nullMask: hasNull ? nullMask : undefined
  };
};

const createNumberColumnBatch = (values: string[]): NumberColumnBatch => {
  const data = new Float64Array(values.length);
  const nullMask = new Uint8Array(values.length);
  let hasNull = false;

  for (let index = 0; index < values.length; index += 1) {
    const analysis = analyzeValue(values[index] ?? '');
    if (analysis.kind === 'null') {
      nullMask[index] = 1;
      hasNull = true;
      continue;
    }

    if (analysis.kind === 'number') {
      data[index] = analysis.numberValue ?? Number.NaN;
    } else {
      nullMask[index] = 1;
      hasNull = true;
    }
  }

  return {
    type: 'number',
    data,
    nullMask: hasNull ? nullMask : undefined
  };
};

const createDatetimeColumnBatch = (values: string[]): DatetimeColumnBatch => {
  const data = new Float64Array(values.length);
  const nullMask = new Uint8Array(values.length);
  let hasNull = false;

  for (let index = 0; index < values.length; index += 1) {
    const analysis = analyzeValue(values[index] ?? '');
    if (analysis.kind === 'null') {
      nullMask[index] = 1;
      hasNull = true;
      continue;
    }

    if (analysis.kind === 'datetime') {
      data[index] = analysis.datetimeValue ?? Number.NaN;
    } else if (analysis.kind === 'number') {
      data[index] = analysis.numberValue ?? Number.NaN;
    } else {
      nullMask[index] = 1;
      hasNull = true;
    }
  }

  return {
    type: 'datetime',
    data,
    nullMask: hasNull ? nullMask : undefined
  };
};

const buildColumnsFromBuilders = (
  header: string[],
  columnValues: string[][],
  inferencer: TypeInferencer | null
): {
  columns: Record<string, ColumnBatch>;
  columnTypes: Record<string, ColumnType>;
  columnInference: Record<string, ColumnInference>;
} => {
  const columnTypes: Record<string, ColumnType> = {};
  const columns: Record<string, ColumnBatch> = {};
  const columnInference: Record<string, ColumnInference> = {};

  for (let colIndex = 0; colIndex < header.length; colIndex += 1) {
    const columnName = header[colIndex];
    const values = columnValues[colIndex] ?? [];
    const inference = inferencer ? inferencer.resolve(columnName) : null;
    const targetType = inference?.type ?? 'string';

    let column: ColumnBatch;
    if (targetType === 'number') {
      column = createNumberColumnBatch(values);
    } else if (targetType === 'boolean') {
      column = createBooleanColumnBatch(values);
    } else if (targetType === 'datetime') {
      column = createDatetimeColumnBatch(values);
    } else {
      column = createStringColumnBatch(values);
    }

    columns[columnName] = column;
    columnTypes[columnName] = targetType;
    columnInference[columnName] =
      inference ?? {
        type: 'string',
        confidence: targetType === 'string' ? 1 : 0,
        samples: 0,
        nullCount: 0,
        examples: []
      };
  }

  return { columns, columnTypes, columnInference };
};

const dedupeHeader = (cells: string[]): string[] => {
  const seen = new Map<string, number>();
  return cells.map((raw, index) => {
    const base = raw && raw.trim().length > 0 ? raw.trim() : `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
};

const normalizeRow = (row: string[], expected: number): string[] => {
  if (row.length === expected) {
    return row;
  }

  if (row.length < expected) {
    const padded = row.slice();
    while (padded.length < expected) {
      padded.push('');
    }
    return padded;
  }

  return row.slice(0, expected);
};

export const parseDelimitedStream = async (
  source: AsyncIterable<Uint8Array>,
  callbacks: ParserCallbacks,
  options: ParserOptions = {}
): Promise<ParserMetrics> => {
  const state = createInitialState();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const checkpointInterval = options.checkpointInterval ?? 50_000;
  const decoder = new TextDecoder(options.encoding ?? 'utf-8');
  let chunkIndex = 0;

  const resolveDelimiterIfNeeded = (): void => {
    if (state.delimiterResolved) {
      return;
    }

    const counts: Array<{ delimiter: Delimiter; count: number }> = [
      { delimiter: ',', count: state.commaCount },
      { delimiter: '\t', count: state.tabCount },
      { delimiter: ';', count: state.semicolonCount }
    ];

    counts.sort((a, b) => b.count - a.count);

    if (counts[0] && counts[0].count > 0) {
      state.delimiter = counts[0].delimiter;
    }

    state.delimiterResolved = true;
    state.commaCount = 0;
    state.tabCount = 0;
    state.semicolonCount = 0;
  };

  if (options.delimiter) {
    state.delimiter = options.delimiter;
    state.delimiterResolved = true;
  }

  const flushBatch = async (eof: boolean): Promise<void> => {
    if (!state.header || state.pendingRowCount === 0) {
      return;
    }

    const rowCount = state.pendingRowCount;
    const startId = state.totalRows;
    const rowIds = new Uint32Array(rowCount);

    for (let idx = 0; idx < rowCount; idx += 1) {
      rowIds[idx] = startId + idx;
    }

    const { columns, columnTypes, columnInference } = buildColumnsFromBuilders(
      state.header,
      state.columnBuilders,
      state.inferencer
    );
    state.totalRows += rowCount;

    const batch: RowBatch = {
      rowIds,
      columns,
      columnTypes,
      columnInference,
      stats: {
        rowsParsed: state.totalRows,
        bytesParsed: state.totalBytes,
        eof
      }
    };

    resetColumnBuilders(state);
    await callbacks.onBatch(batch);
  };

  const emitRow = async (): Promise<void> => {
    const rowCells = state.currentRow;
    state.currentRow = [];

    if (!state.header) {
      state.header = dedupeHeader(rowCells);
      state.delimiterResolved = true;
      state.inferencer = new TypeInferencer(state.header);
      resetColumnBuilders(state);
      state.currentRowStartOffset = state.totalBytes;

      if (callbacks.onHeader) {
        await callbacks.onHeader(state.header);
      }
      return;
    }

    if (state.pendingRowCount >= batchSize) {
      await flushBatch(false);
    }

    const normalized = normalizeRow(rowCells, state.header.length);
    state.inferencer?.updateRow(normalized);
    if (options.fuzzyIndexBuilder) {
      const start = timestamp();
      options.fuzzyIndexBuilder.addRow(state.header, normalized);
      state.fuzzyRowBuildMs += timestamp() - start;
    }
    ensureColumnBuilders(state);
    for (let columnIndex = 0; columnIndex < state.header.length; columnIndex += 1) {
      const columnValues = state.columnBuilders[columnIndex];
      if (columnValues) {
        columnValues.push(normalized[columnIndex] ?? '');
      }
    }
    state.pendingRowCount += 1;

    const rowIndex = state.totalRows + state.pendingRowCount - 1;
    const rowStartOffset = state.currentRowStartOffset;

    if (checkpointInterval > 0 && callbacks.onCheckpoint && rowIndex % checkpointInterval === 0) {
      await callbacks.onCheckpoint({ rowIndex, byteOffset: rowStartOffset });
    }

    state.currentRowStartOffset = state.totalBytes;
  };

  const pushField = (): void => {
    state.currentRow.push(state.fieldBuffer);
    state.fieldBuffer = '';
  };

  const handleEndOfRow = async (): Promise<void> => {
    pushField();
    await emitRow();
  };

  const processChar = (char: string): Promise<void> | void => {
    if (state.inQuotes) {
      if (state.quoteEscapePending) {
        if (char === '"') {
          state.fieldBuffer += '"';
          state.quoteEscapePending = false;
          return;
        }

        state.inQuotes = false;
        state.quoteEscapePending = false;
        // fall through to process the char outside quotes
      } else {
        if (char === '"') {
          state.quoteEscapePending = true;
          return;
        }

        state.fieldBuffer += char;
        return;
      }
    }

    if (!state.delimiterResolved && (char === '\n' || char === '\r')) {
      resolveDelimiterIfNeeded();
    }

    if (!state.delimiterResolved && char === ',') {
      state.commaCount += 1;
    } else if (!state.delimiterResolved && char === '\t') {
      state.tabCount += 1;
    } else if (!state.delimiterResolved && char === ';') {
      state.semicolonCount += 1;
    }

    if (char === '"') {
      state.inQuotes = true;
      state.quoteEscapePending = false;
      return;
    }

    if (
      char === state.delimiter ||
      (!state.delimiterResolved && (char === ',' || char === '\t' || char === ';'))
    ) {
      pushField();
      return;
    }

    if (char === '\n') {
      return handleEndOfRow();
    }

    if (char === '\r') {
      state.skipNextLF = true;
      return handleEndOfRow();
    }

    state.fieldBuffer += char;
  };

  const processText = async (text: string, isFirstChunk: boolean): Promise<void> => {
    if (isFirstChunk && text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
      state.totalBytes += 3;
      state.currentRowStartOffset = 3;
    }

    for (let index = 0; index < text.length;) {
      const codePoint = text.codePointAt(index)!;
      const char = String.fromCodePoint(codePoint);
      const byteLength = utf8ByteLength(codePoint);
      index += char.length;

      state.totalBytes += byteLength;

      if (!state.delimiterResolved && (char === '\n' || char === '\r')) {
        resolveDelimiterIfNeeded();
      }

      if (state.skipNextLF) {
        if (char === '\n') {
          state.skipNextLF = false;
          continue;
        }

        state.skipNextLF = false;
      }

      const maybePromise = processChar(char);
      if (maybePromise) {
        await maybePromise;
      }
    }
  };

  for await (const chunk of source) {
    let text = decoder.decode(chunk, { stream: true });
    if (text.length > 0) {
      await processText(text, chunkIndex === 0);
    }
    chunkIndex += 1;
  }

  const tail = decoder.decode();
  if (tail.length > 0) {
    await processText(tail, chunkIndex === 0);
  }

  if (state.fieldBuffer.length > 0 || state.currentRow.length > 0) {
    pushField();
    await emitRow();
  }

  await flushBatch(true);
  return {
    fuzzyRowBuildMs: state.fuzzyRowBuildMs
  };
};
