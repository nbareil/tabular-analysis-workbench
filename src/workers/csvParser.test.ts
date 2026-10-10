import { describe, expect, it } from 'vitest';

import { dedupeHeader, parseDelimitedStream, sniffDelimiter, type ParserOptions } from './csvParser';
import type { ColumnBatch, RowBatch } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function* chunksOf(parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield part;
  }
}

const decodeColumn = (column: ColumnBatch): string[] => {
  const bytes = new Uint8Array(column.data);
  return Array.from({ length: column.offsets.length - 1 }, (_, index) =>
    decoder.decode(bytes.subarray(column.offsets[index]!, column.offsets[index + 1]!))
  );
};

interface ParseResult {
  header: string[];
  rows: string[][];
  batches: RowBatch[];
}

const parseBytes = async (parts: Uint8Array[], options?: ParserOptions): Promise<ParseResult> => {
  let header: string[] = [];
  const batches: RowBatch[] = [];
  await parseDelimitedStream(
    chunksOf(parts),
    {
      onColumns: (value) => {
        header = value;
      },
      onBatch: (batch) => {
        batches.push(batch);
      }
    },
    options
  );
  const rows: string[][] = [];
  for (const batch of batches) {
    const columns = header.map((name) => decodeColumn(batch.columns[name]!));
    for (let index = 0; index < batch.rowIds.length; index += 1) {
      rows.push(columns.map((values) => values[index]!));
    }
  }
  return { header, rows, batches };
};

const parse = (text: string, options?: ParserOptions) => parseBytes([encoder.encode(text)], options);

/** Parses `text` split into two byte chunks at every possible position. */
const parseAtEverySplit = async (text: string): Promise<ParseResult[]> => {
  const bytes = encoder.encode(text);
  const results: ParseResult[] = [];
  for (let split = 0; split <= bytes.length; split += 1) {
    results.push(await parseBytes([bytes.subarray(0, split), bytes.subarray(split)]));
  }
  return results;
};

describe('parseDelimitedStream', () => {
  it('parses quoted fields with delimiters, newlines and escaped quotes', async () => {
    const { header, rows } = await parse('a,b,c\n"x,y","line1\nline2","say ""hi"""\n');
    expect(header).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([['x,y', 'line1\nline2', 'say "hi"']]);
  });

  it('treats a quote inside an unquoted field as literal text', async () => {
    const { rows } = await parse('item,size\n12" disk,big\nfoo"bar,"baz"\n');
    expect(rows).toEqual([
      ['12" disk', 'big'],
      ['foo"bar', 'baz']
    ]);
  });

  it.each([
    ['tab', 'a\tb\n1,5\t2\n', ['1,5', '2']],
    ['semicolon', 'a;b\n1,5;2\n', ['1,5', '2']],
    ['pipe', 'a|b\n1,5|2\n', ['1,5', '2']],
    ['comma', 'a,b\n1;5,2\n', ['1;5', '2']]
  ])('sniffs a %s delimiter from the header line', async (_name, text, row) => {
    const { header, rows } = await parse(text);
    expect(header).toEqual(['a', 'b']);
    expect(rows).toEqual([row]);
  });

  it('sniffs the delimiter even when the header line spans several chunks', async () => {
    const parts = ['na', 'me\tval', 'ue\n', 'x,1\t2\n'].map((part) => encoder.encode(part));
    const { header, rows } = await parseBytes(parts);
    expect(header).toEqual(['name', 'value']);
    expect(rows).toEqual([['x,1', '2']]);
  });

  it('honours an explicit delimiter', async () => {
    const { rows } = await parse('a;b\n1;2\n', { delimiter: ',' });
    expect(rows).toEqual([['1;2']]);
  });

  it('ignores delimiters inside quoted header cells when sniffing', async () => {
    const { header } = await parse('"a,b,c";d;e\n1;2;3\n');
    expect(header).toEqual(['a,b,c', 'd', 'e']);
  });

  it('handles CRLF, lone CR, blank lines and a missing trailing newline', async () => {
    const { rows } = await parse('\r\na,b\r\n1,2\r\n\r\n3,4\r5,6\n\n7,8');
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
      ['7', '8']
    ]);
  });

  it('keeps rows made of empty fields', async () => {
    const { rows } = await parse('a,b\n,\n""\n');
    expect(rows).toEqual([
      ['', ''],
      ['', '']
    ]);
  });

  it('pads short rows and folds extra fields into the last column, counting both as malformed', async () => {
    const { rows, batches } = await parse('a,b,c\n1\n1,2,3,4,5\n1,2,3\n');
    expect(rows).toEqual([
      ['1', '', ''],
      ['1', '2', '3,4,5'],
      ['1', '2', '3']
    ]);
    expect(batches.at(-1)!.stats.malformedRows).toBe(2);
  });

  it('strips a UTF-8 BOM, even when split across chunks', async () => {
    const bytes = encoder.encode('\uFEFFid,name\n1,é\n');
    for (const split of [1, 2, 3]) {
      const { header, rows } = await parseBytes([bytes.subarray(0, split), bytes.subarray(split)]);
      expect(header).toEqual(['id', 'name']);
      expect(rows).toEqual([['1', 'é']]);
    }
  });

  it('produces identical output wherever the chunk boundary falls', async () => {
    const text = 'id;note;city\r\n1;"a ""quoted"" ;\r\nvalue";Zürich 🚀\r\n2;12" disk;"x"\r\n\r\n3;;"end"""\r\n';
    const expected = await parse(text);
    expect(expected.header).toEqual(['id', 'note', 'city']);
    expect(expected.rows).toEqual([
      ['1', 'a "quoted" ;\r\nvalue', 'Zürich 🚀'],
      ['2', '12" disk', 'x'],
      ['3', '', 'end"']
    ]);
    for (const result of await parseAtEverySplit(text)) {
      expect(result.header).toEqual(expected.header);
      expect(result.rows).toEqual(expected.rows);
    }
  });

  it('produces identical output when fed one byte at a time', async () => {
    const text = 'a,b\n"x""y",ü\r\n"1\n2",3\n';
    const bytes = encoder.encode(text);
    const single = await parseBytes(Array.from(bytes, (_, index) => bytes.subarray(index, index + 1)));
    expect(single.rows).toEqual((await parse(text)).rows);
  });

  it('emits batches of batchSize with consecutive row ids and running stats', async () => {
    const text = `n\n${Array.from({ length: 5 }, (_, index) => index).join('\n')}\n`;
    const { batches } = await parse(text, { batchSize: 2 });
    expect(batches.map((batch) => Array.from(batch.rowIds))).toEqual([[0, 1], [2, 3], [4]]);
    expect(batches.map((batch) => batch.stats.rowsParsed)).toEqual([2, 4, 5]);
    expect(batches.at(-1)!.stats.eof).toBe(true);
    expect(batches.at(-1)!.stats.bytesParsed).toBe(encoder.encode(text).length);
    expect(batches.at(-1)!.columnTypes).toEqual({ n: 'number' });
  });

  it('stores raw cell text and infers types over all rows', async () => {
    const { rows, batches } = await parse('when,flag,n\n2024-01-01 00:00, yes ,007\n');
    expect(rows).toEqual([['2024-01-01 00:00', ' yes ', '007']]);
    expect(batches[0]!.columnTypes).toEqual({ when: 'datetime', flag: 'boolean', n: 'number' });
  });

  it('renames duplicate, empty and reserved header names', async () => {
    const { header } = await parse('id,id,,__rowId,__tag,__proto__,extra\n1,2,3,4,5,6,7\n', {
      reservedColumns: ['extra']
    });
    expect(new Set(header).size).toBe(header.length);
    expect(header).toEqual(['id', 'id_2', 'column_3', '__rowId_2', '__tag_2', '__proto___2', 'extra_2']);
  });
});

describe('dedupeHeader', () => {
  it('never produces a name that collides with a later header cell', () => {
    const header = dedupeHeader(['a', 'a', 'a_2']);
    expect(new Set(header).size).toBe(3);
    expect(header[0]).toBe('a');
  });

  it('trims names', () => {
    expect(dedupeHeader([' a ', 'b'])).toEqual(['a', 'b']);
  });
});

describe('sniffDelimiter', () => {
  it('defaults to comma for a single-column header', () => {
    expect(sniffDelimiter('value')).toBe(',');
  });
});
