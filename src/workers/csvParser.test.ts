import { describe, expect, it } from 'vitest';

import { parseDelimitedStream } from './csvParser';
import type {
  ColumnBatch,
  NumberColumnBatch,
  RowBatch,
  StringColumnBatch
} from './types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const decodeStringColumn = (column: ColumnBatch): string[] => {
  expect(column.type).toBe('string');
  const stringColumn = column as StringColumnBatch;
  const offsets = stringColumn.offsets;
  const values: string[] = [];
  const dataView = new Uint8Array(stringColumn.data, offsets.length * Uint32Array.BYTES_PER_ELEMENT);

  for (let index = 0; index < offsets.length - 1; index += 1) {
    const start = offsets[index]!;
    const end = offsets[index + 1]!;
    const slice = dataView.subarray(start, end);
    values.push(textDecoder.decode(slice));
  }

  return values;
};

const decodeNumberColumn = (column: ColumnBatch): number[] => {
  expect(column.type).toBe('number');
  const numberColumn = column as NumberColumnBatch;
  return Array.from(numberColumn.data);
};

const iterableFromStrings = (chunks: string[]): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield textEncoder.encode(chunk);
    }
  }
});

const collectBatches = async (
  chunks: string[],
  options?: Parameters<typeof parseDelimitedStream>[2]
): Promise<{ header: string[]; batches: RowBatch[] }> => {
  const source = iterableFromStrings(chunks);
  const batches: RowBatch[] = [];
  let header: string[] = [];

  await parseDelimitedStream(
    source,
    {
      onHeader: async (cols) => {
        header = cols;
      },
      onBatch: async (batch) => {
        batches.push(batch);
      }
    },
    options
  );

  return { header, batches };
};

describe('parseDelimitedStream', () => {
  it('parses comma separated data with quoted fields and emits batches', async () => {
    const csvChunks = ['name,age,notes\r\n"Alice, A.",30,"Loves ""quoted"" text"\r\n', 'Bob,25,\r\n'];

    const { header, batches } = await collectBatches(csvChunks, { batchSize: 1 });
    expect(header).toEqual(['name', 'age', 'notes']);
    expect(batches).toHaveLength(2);

    const [firstBatch, secondBatch] = batches;
    expect(Array.from(firstBatch.rowIds)).toEqual([0]);
    expect(firstBatch.stats.eof).toBe(false);
    expect(Array.from(secondBatch.rowIds)).toEqual([1]);
    expect(secondBatch.stats.eof).toBe(true);

    expect(firstBatch.columnTypes.age).toBe('number');
    expect(firstBatch.columnTypes.name).toBe('string');
    expect(firstBatch.columnInference.age.type).toBe('number');
    expect(firstBatch.columnInference.age.confidence).toBeGreaterThan(0.9);

    const namesFirst = decodeStringColumn(firstBatch.columns.name);
    const agesFirst = decodeNumberColumn(firstBatch.columns.age);
    const notesFirst = decodeStringColumn(firstBatch.columns.notes);

    expect(namesFirst).toEqual(['Alice, A.']);
    expect(agesFirst).toEqual([30]);
    expect(notesFirst).toEqual(['Loves "quoted" text']);

    const namesSecond = decodeStringColumn(secondBatch.columns.name);
    const agesSecond = decodeNumberColumn(secondBatch.columns.age);
    const notesSecond = decodeStringColumn(secondBatch.columns.notes);

    expect(namesSecond).toEqual(['Bob']);
    expect(agesSecond).toEqual([25]);
    expect(notesSecond).toEqual(['']);
  });

  it('auto-detects tab delimiters and handles chunk boundaries inside quotes', async () => {
    const chunks = ['title\tcomment\n"New', 'line"\t"Spans\nchunks"\nSecond\tRow\n'];

    const { header, batches } = await collectBatches(chunks, { batchSize: 5 });
    expect(header).toEqual(['title', 'comment']);
    expect(batches).toHaveLength(1);

    const batch = batches[0]!;
    expect(Array.from(batch.rowIds)).toEqual([0, 1]);
    expect(batch.stats.eof).toBe(true);

    expect(batch.columnTypes.title).toBe('string');
    expect(batch.columnTypes.comment).toBe('string');
    expect(batch.columnInference.title.type).toBe('string');

    expect(decodeStringColumn(batch.columns.title)).toEqual(['Newline', 'Second']);
    expect(decodeStringColumn(batch.columns.comment)).toEqual(['Spans\nchunks', 'Row']);
  });

  it('auto-detects semicolon delimiters', async () => {
    const chunks = [
      'col1;col2;col3\n',
      '"Value;One";Second;Third\nFourth;"Fifth;Value";Sixth\n'
    ];

    const { header, batches } = await collectBatches(chunks, { batchSize: 10 });
    expect(header).toEqual(['col1', 'col2', 'col3']);
    expect(batches).toHaveLength(1);

    const batch = batches[0]!;
    expect(Array.from(batch.rowIds)).toEqual([0, 1]);
    expect(batch.stats.eof).toBe(true);

    expect(decodeStringColumn(batch.columns.col1)).toEqual(['Value;One', 'Fourth']);
    expect(decodeStringColumn(batch.columns.col2)).toEqual(['Second', 'Fifth;Value']);
    expect(decodeStringColumn(batch.columns.col3)).toEqual(['Third', 'Sixth']);
  });
});
