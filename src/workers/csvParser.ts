import type { ColumnBatch, Delimiter, RowBatch } from './types';
import { TAG_COLUMN_ID } from './types';
import { TypeInferencer } from './typeInference';

export interface ParserOptions {
  delimiter?: Delimiter;
  batchSize?: number;
  encoding?: string;
  /** Extra header names to avoid, e.g. a column the caller adds itself. */
  reservedColumns?: string[];
}

export interface ParserCallbacks {
  onHeader?: (header: string[]) => void | Promise<void>;
  onBatch: (batch: RowBatch) => void | Promise<void>;
}

const DEFAULT_BATCH_SIZE = 10_000;
const CANDIDATE_DELIMITERS: Delimiter[] = ['\t', ',', ';', '|'];
const RESERVED_COLUMN_NAMES = new Set(['__rowId', TAG_COLUMN_ID, '__proto__']);

const textEncoder = new TextEncoder();

export const encodeColumn = (values: string[]): ColumnBatch => {
  const encoded = values.map((value) => textEncoder.encode(value));
  const offsets = new Uint32Array(values.length + 1);
  let total = 0;
  encoded.forEach((bytes, index) => {
    total += bytes.byteLength;
    offsets[index + 1] = total;
  });
  const data = new Uint8Array(total);
  encoded.forEach((bytes, index) => data.set(bytes, offsets[index]!));
  return { data: data.buffer, offsets };
};

/** Picks the candidate delimiter that occurs most often outside quotes in the header line. */
export const sniffDelimiter = (headerLine: string): Delimiter => {
  const counts = new Map<string, number>();
  let inQuotes = false;
  for (const char of headerLine) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }
  let best: Delimiter = ',';
  let bestCount = 0;
  for (const candidate of CANDIDATE_DELIMITERS) {
    const count = counts.get(candidate) ?? 0;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
};

export const dedupeHeader = (cells: string[], reserved: string[] = []): string[] => {
  const used = new Set<string>(reserved);
  return cells.map((raw, index) => {
    const base = raw.trim() || `column_${index + 1}`;
    let candidate = base;
    let suffix = 1;
    while (used.has(candidate) || RESERVED_COLUMN_NAMES.has(candidate)) {
      suffix += 1;
      candidate = `${base}_${suffix}`;
    }
    used.add(candidate);
    return candidate;
  });
};

const LF = 10;
const CR = 13;
const QUOTE = 34;

export const parseDelimitedStream = async (
  source: AsyncIterable<Uint8Array>,
  callbacks: ParserCallbacks,
  options: ParserOptions = {}
): Promise<void> => {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const decoder = new TextDecoder(options.encoding ?? 'utf-8');

  let delimiter = options.delimiter ?? null;
  let delimiterCode = delimiter ? delimiter.charCodeAt(0) : -1;
  let pendingText = '';

  let header: string[] | null = null;
  let inferencer: TypeInferencer | null = null;
  let columnValues: string[][] = [];
  let pendingRows = 0;
  let totalRows = 0;
  let bytesParsed = 0;
  let malformedRows = 0;

  let row: string[] = [];
  let field = '';
  let fieldStarted = false;
  let inQuotes = false;
  let quotePending = false;
  let skipLF = false;

  const flushBatch = async (eof: boolean): Promise<void> => {
    if (!header || pendingRows === 0) {
      return;
    }
    const rowIds = new Uint32Array(pendingRows);
    for (let index = 0; index < pendingRows; index += 1) {
      rowIds[index] = totalRows + index;
    }
    const columns: Record<string, ColumnBatch> = {};
    header.forEach((name, index) => {
      columns[name] = encodeColumn(columnValues[index]!);
    });
    totalRows += pendingRows;
    pendingRows = 0;
    columnValues = header.map(() => []);
    const { columnTypes, columnInference } = inferencer!.resolveAll();
    await callbacks.onBatch({
      rowIds,
      columns,
      columnTypes,
      columnInference,
      stats: { rowsParsed: totalRows, bytesParsed, malformedRows, eof }
    });
  };

  const endRow = async (): Promise<void> => {
    row.push(field);
    const cells = row;
    const isBlank = cells.length === 1 && !fieldStarted;
    row = [];
    field = '';
    fieldStarted = false;
    if (isBlank) {
      return;
    }

    if (!header) {
      header = dedupeHeader(cells, options.reservedColumns);
      inferencer = new TypeInferencer(header);
      columnValues = header.map(() => []);
      await callbacks.onHeader?.(header);
      return;
    }

    const width = header.length;
    if (cells.length !== width) {
      malformedRows += 1;
      if (cells.length > width) {
        cells[width - 1] = cells.slice(width - 1).join(delimiter!);
        cells.length = width;
      } else {
        while (cells.length < width) {
          cells.push('');
        }
      }
    }

    inferencer!.updateRow(cells);
    for (let index = 0; index < width; index += 1) {
      columnValues[index]!.push(cells[index]!);
    }
    pendingRows += 1;
    if (pendingRows >= batchSize) {
      await flushBatch(false);
    }
  };

  const processText = async (text: string): Promise<void> => {
    let index = 0;
    const length = text.length;

    while (index < length) {
      if (skipLF) {
        skipLF = false;
        if (text.charCodeAt(index) === LF) {
          index += 1;
          continue;
        }
      }

      if (quotePending) {
        quotePending = false;
        if (text.charCodeAt(index) === QUOTE) {
          field += '"';
          index += 1;
          continue;
        }
        inQuotes = false;
      }

      if (inQuotes) {
        const quoteIndex = text.indexOf('"', index);
        if (quoteIndex === -1) {
          field += text.slice(index);
          return;
        }
        field += text.slice(index, quoteIndex);
        index = quoteIndex + 1;
        if (index === length) {
          quotePending = true;
          return;
        }
        if (text.charCodeAt(index) === QUOTE) {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }

      if (!fieldStarted && text.charCodeAt(index) === QUOTE) {
        inQuotes = true;
        fieldStarted = true;
        index += 1;
        continue;
      }

      let end = index;
      let code = -1;
      while (end < length) {
        code = text.charCodeAt(end);
        if (code === delimiterCode || code === LF || code === CR) {
          break;
        }
        end += 1;
      }
      if (end > index) {
        field += text.slice(index, end);
        fieldStarted = true;
      }
      if (end === length) {
        return;
      }

      index = end + 1;
      if (code === delimiterCode) {
        row.push(field);
        field = '';
        fieldStarted = false;
      } else {
        skipLF = code === CR;
        await endRow();
      }
    }
  };

  const consume = async (text: string, final: boolean): Promise<void> => {
    if (!delimiter) {
      pendingText += text;
      const newline = pendingText.search(/[\r\n]/);
      if (newline === -1 && !final) {
        return;
      }
      delimiter = sniffDelimiter(newline === -1 ? pendingText : pendingText.slice(0, newline));
      delimiterCode = delimiter.charCodeAt(0);
      text = pendingText;
      pendingText = '';
    }
    await processText(text);
  };

  for await (const chunk of source) {
    bytesParsed += chunk.byteLength;
    const text = decoder.decode(chunk, { stream: true });
    if (text.length > 0) {
      await consume(text, false);
    }
  }
  await consume(decoder.decode(), true);

  if (fieldStarted || row.length > 0) {
    await endRow();
  }

  await flushBatch(true);
};
