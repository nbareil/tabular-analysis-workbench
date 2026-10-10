import { describe, expect, it } from 'vitest';

import {
  MALFORMED_LINE_COLUMN,
  MAX_FLATTEN_DEPTH,
  MAX_JSON_COLUMNS,
  OTHER_FIELDS_COLUMN,
  parseJsonLinesStream
} from './jsonLinesParser';
import type { ParserOptions } from './csvParser';
import type { ColumnBatch, RowBatch } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function* chunksOf(parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield part;
  }
}

/** One cell per row, '' where a sparse column has nothing. */
const decodeColumn = (column: ColumnBatch, rowCount: number): string[] => {
  const bytes = new Uint8Array(column.data);
  const values = Array.from({ length: column.offsets.length - 1 }, (_, index) =>
    decoder.decode(bytes.subarray(column.offsets[index]!, column.offsets[index + 1]!))
  );
  if (!column.rows) {
    return values;
  }
  const cells = new Array<string>(rowCount).fill('');
  column.rows.forEach((row, index) => {
    cells[row] = values[index]!;
  });
  return cells;
};

interface ParseResult {
  columns: string[];
  /** Each row's non-empty cells. */
  rows: Array<Record<string, string>>;
  batches: RowBatch[];
  columnReports: string[][];
}

const parseBytes = async (parts: Uint8Array[], options?: ParserOptions): Promise<ParseResult> => {
  const columnReports: string[][] = [];
  const batches: RowBatch[] = [];
  await parseJsonLinesStream(
    chunksOf(parts),
    {
      onColumns: (columns) => {
        columnReports.push(columns);
      },
      onBatch: (batch) => {
        batches.push(batch);
      }
    },
    options
  );
  const rows: Array<Record<string, string>> = [];
  for (const batch of batches) {
    const rowCount = batch.rowIds.length;
    const decoded = Object.entries(batch.columns).map(([name, column]) => [name, decodeColumn(column, rowCount)] as const);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push(Object.fromEntries(decoded.filter(([, cells]) => cells[index]).map(([name, cells]) => [name, cells[index]!])));
    }
  }
  return { columns: columnReports.at(-1) ?? [], rows, batches, columnReports };
};

const parse = (text: string, options?: ParserOptions) => parseBytes([encoder.encode(text)], options);

describe('parseJsonLinesStream', () => {
  it('flattens nested objects into dotted columns and keeps literal text', async () => {
    const { columns, rows } = await parse(
      '{"id":12345678901234567890,"user":{"name":"alice","geo":{"city":"Zürich"}},"tags":["a", {"b":1.50}],' +
        '"ok":true,"no":false,"gone":null,"ratio":1.50,"big":-1E+400,"meta":{}}\n'
    );
    expect(columns).toEqual(['id', 'user.name', 'user.geo.city', 'tags', 'ok', 'no', 'gone', 'ratio', 'big', 'meta']);
    expect(rows).toEqual([
      {
        id: '12345678901234567890',
        'user.name': 'alice',
        'user.geo.city': 'Zürich',
        tags: '["a", {"b":1.50}]',
        ok: 'true',
        no: 'false',
        ratio: '1.50',
        big: '-1E+400',
        meta: '{}'
      }
    ]);
  });

  it('unescapes strings', async () => {
    const { rows } = await parse(
      String.raw`{"path":"C:\\Windows\\System32\\","quote":"say \"hi\"","lines":"a\nb\tc","u":"\u00e9\uD83D\uDE80","slash":"a\/b"}` +
        '\n'
    );
    expect(rows).toEqual([
      { path: 'C:\\Windows\\System32\\', quote: 'say "hi"', lines: 'a\nb\tc', u: 'é🚀', slash: 'a/b' }
    ]);
  });

  it('orders columns by path, so a parent keeps its keys together however late they appear', async () => {
    const { columns, columnReports } = await parse('{"a":{"x":1},"b":2}\n{"c":3,"a":{"y":4}}\n', { batchSize: 1 });
    expect(columnReports).toEqual([
      ['a.x', 'b'],
      ['a.x', 'a.y', 'b', 'c']
    ]);
    expect(columns).toEqual(['a.x', 'a.y', 'b', 'c']);
  });

  it('reports columns only before batches that add some', async () => {
    const { columnReports, batches } = await parse('{"a":1}\n{"a":2}\n{"b":3}\n', { batchSize: 1 });
    expect(batches).toHaveLength(3);
    expect(columnReports).toEqual([['a'], ['a', 'b']]);
  });

  it('stores a key that few rows have only for those rows', async () => {
    const lines = Array.from({ length: 10 }, (_, index) => JSON.stringify(index === 3 ? { id: index, rare: 'x' } : { id: index }));
    const { batches, rows } = await parse(`${lines.join('\n')}\n`);
    expect(Array.from(batches[0]!.columns.rare!.rows!)).toEqual([3]);
    expect(batches[0]!.columns.id!.rows).toBeUndefined();
    expect(rows[3]).toEqual({ id: '3', rare: 'x' });
  });

  it('keeps lines that are not JSON objects as malformed rows and skips blank ones', async () => {
    const { columns, rows, batches } = await parse(
      '{"a":1}\r\n\r\nnot json\n  \n[1,2]\n"text"\n{"a":\n{"a":1}{"b":2}\n{"a":1,}\n{"a":1}'
    );
    expect(columns).toEqual(['a', MALFORMED_LINE_COLUMN]);
    expect(rows).toEqual([
      { a: '1' },
      { [MALFORMED_LINE_COLUMN]: 'not json' },
      { [MALFORMED_LINE_COLUMN]: '[1,2]' },
      { [MALFORMED_LINE_COLUMN]: '"text"' },
      { [MALFORMED_LINE_COLUMN]: '{"a":' },
      { [MALFORMED_LINE_COLUMN]: '{"a":1}{"b":2}' },
      { [MALFORMED_LINE_COLUMN]: '{"a":1,}' },
      { a: '1' }
    ]);
    expect(batches.at(-1)!.stats.malformedRows).toBe(6);
  });

  it('keeps the last value of a repeated key, as JSON.parse does', async () => {
    const { rows } = await parse('{"a":1,"a":2}\n{"a":"x","a":null}\n{"a":"","a":"y"}\n');
    expect(rows).toEqual([{ a: '2' }, {}, { a: 'y' }]);
  });

  it('keeps an empty record as a row without cells', async () => {
    const { rows } = await parse('{}\n{ }\n');
    expect(rows).toEqual([{}, {}]);
  });

  it(`keeps objects nested deeper than ${MAX_FLATTEN_DEPTH} levels as JSON text`, async () => {
    const keys = Array.from({ length: MAX_FLATTEN_DEPTH + 3 }, (_, index) => `k${index}`);
    const line = keys.reduceRight((inner, key) => `{"${key}":${inner}}`, '1');
    const { rows } = await parse(`${line}\n`);
    expect(rows).toEqual([{ [keys.slice(0, MAX_FLATTEN_DEPTH).join('.')]: '{"k20":{"k21":{"k22":1}}}' }]);
  });

  it('survives nesting far deeper than the call stack', async () => {
    const depth = 200_000;
    const arrays = `${'['.repeat(depth)}1${']'.repeat(depth)}`;
    const objects = `${'{"k":'.repeat(depth)}1${'}'.repeat(depth)}`;
    const { rows } = await parse(`{"arrays":${arrays}}\n${objects}\n{"broken":${'['.repeat(depth)}\n`);
    expect(rows[0]!.arrays).toBe(arrays);
    // The first MAX_FLATTEN_DEPTH objects become the path; the rest keeps its text.
    expect(rows[1]).toEqual({
      [Array(MAX_FLATTEN_DEPTH).fill('k').join('.')]: objects.slice(MAX_FLATTEN_DEPTH * 5, -MAX_FLATTEN_DEPTH)
    });
    expect(rows[2]).toEqual({ [MALFORMED_LINE_COLUMN]: `{"broken":${'['.repeat(depth)}` });
  });

  it(`puts keys beyond ${MAX_JSON_COLUMNS} columns into ${OTHER_FIELDS_COLUMN}`, async () => {
    const wide = Object.fromEntries(Array.from({ length: MAX_JSON_COLUMNS }, (_, index) => [`k${index}`, index]));
    const { columns, rows } = await parse(
      `${JSON.stringify(wide)}\n{"k0":"a","late":{"x":1,"y":null},"later":"b"}\n{"later":"c","later":"d"}\n`
    );
    expect(columns).toHaveLength(MAX_JSON_COLUMNS + 1);
    expect(columns.at(-1)).toBe(OTHER_FIELDS_COLUMN);
    expect(rows[1]).toEqual({ k0: 'a', [OTHER_FIELDS_COLUMN]: '{"late.x":"1","later":"b"}' });
    expect(rows[2]).toEqual({ [OTHER_FIELDS_COLUMN]: '{"later":"d"}' });
  });

  it('renames colliding, empty and reserved column names', async () => {
    const { columns } = await parse('{"a.b":1,"a":{"b":2},"__rowId":3,"":4,"source_file":5,"__proto__":6}\n', {
      reservedColumns: ['source_file']
    });
    expect(columns).toEqual(['a.b', 'a.b_2', '__rowId_2', 'column_4', 'source_file_2', '__proto___2']);
  });

  it('produces identical output wherever the chunk boundary falls', async () => {
    const text = '\uFEFF{"id":1,"note":"a \\"quoted\\" ;\\nvalue","city":"Zürich 🚀"}\r\n\r\n{"id":2,"x":[1, "]"]}\nbad 🚀\n{"id":3}';
    const expected = await parse(text);
    expect(expected.rows).toEqual([
      { id: '1', note: 'a "quoted" ;\nvalue', city: 'Zürich 🚀' },
      { id: '2', x: '[1, "]"]' },
      { [MALFORMED_LINE_COLUMN]: 'bad 🚀' },
      { id: '3' }
    ]);
    const bytes = encoder.encode(text);
    for (let split = 0; split <= bytes.length; split += 1) {
      const result = await parseBytes([bytes.subarray(0, split), bytes.subarray(split)]);
      expect(result.columns).toEqual(expected.columns);
      expect(result.rows).toEqual(expected.rows);
    }
    const single = await parseBytes(Array.from(bytes, (_, index) => bytes.subarray(index, index + 1)));
    expect(single.rows).toEqual(expected.rows);
  });

  it('emits batches of batchSize with consecutive row ids and running stats', async () => {
    const text = `${Array.from({ length: 5 }, (_, index) => `{"n":${index}}`).join('\n')}\n`;
    const { batches } = await parse(text, { batchSize: 2 });
    expect(batches.map((batch) => Array.from(batch.rowIds))).toEqual([[0, 1], [2, 3], [4]]);
    expect(batches.map((batch) => batch.stats.rowsParsed)).toEqual([2, 4, 5]);
    expect(batches.at(-1)!.stats.eof).toBe(true);
    expect(batches.at(-1)!.stats.bytesParsed).toBe(encoder.encode(text).length);
  });

  it('infers types over all rows, counting rows without a key as empty', async () => {
    const { batches } = await parse('{"when":"2024-01-01T00:00:00Z","n":1}\n{"flag":true,"n":2}\n{"n":3}\n', { batchSize: 2 });
    const last = batches.at(-1)!;
    expect(last.columnTypes).toEqual({ when: 'datetime', n: 'number', flag: 'boolean' });
    expect(last.columnInference.when).toMatchObject({ samples: 3, nullCount: 2 });
  });
});

/** Deterministic pseudo-random numbers (mulberry32). */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

// No '.' (it joins paths) and no whitespace-only keys (blank names become column_N).
const KEY_CHARACTERS = ['a', 'b', 'é', '🚀', '"', '\\', '\u0001', '_'];
const TEXT_CHARACTERS = [...KEY_CHARACTERS, ' ', '\t', '/', '\n', '\r', '\u2028', '{', '[', ',', ':', '1'];

const generateDocument = (next: () => number): Record<string, unknown> => {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const text = (characters: string[], minLength: number) =>
    Array.from({ length: minLength + Math.floor(next() * 5) }, () => pick(characters)).join('');
  const value = (depth: number): unknown => {
    switch (Math.floor(next() * (depth > 3 ? 5 : 7))) {
      case 0:
        return text(TEXT_CHARACTERS, 0);
      case 1:
        return pick([0, -1, 1.5, 3e-7, 2 ** 60, -123.456, 1e21]);
      case 2:
        return pick([true, false]);
      case 3:
        return null;
      case 4:
        return text(TEXT_CHARACTERS, 1);
      case 5:
        return object(depth + 1);
      default:
        return Array.from({ length: Math.floor(next() * 3) }, () => value(depth + 1));
    }
  };
  const object = (depth: number): Record<string, unknown> =>
    Object.fromEntries(
      Array.from({ length: (depth === 0 ? 1 : 0) + Math.floor(next() * (depth === 0 ? 5 : 4)) }, () => [
        text(KEY_CHARACTERS, 1),
        value(depth)
      ])
    );
  return object(0);
};

/** Flattens a JSON.parse result the way the parser should: non-empty cells by path. */
const referenceCells = (record: object, prefix = '', cells: Record<string, string> = {}): Record<string, string> => {
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === '') {
      delete cells[path];
    } else if (Array.isArray(value)) {
      cells[path] = JSON.stringify(value);
    } else if (typeof value === 'object') {
      if (Object.keys(value).length === 0) {
        cells[path] = '{}';
      } else {
        referenceCells(value, path, cells);
      }
    } else {
      cells[path] = String(value);
    }
  }
  return cells;
};

const isJsonObject = (line: string): boolean => {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
};

describe('parseJsonLinesStream compared with JSON.parse', () => {
  it('flattens random documents to the same cells', async () => {
    const next = random(42);
    // Several small files, each sharing paths across lines but staying under the column limit.
    for (let file = 0; file < 20; file += 1) {
      const documents = Array.from({ length: 25 }, () => generateDocument(next));
      const { rows } = await parse(`${documents.map((document) => JSON.stringify(document)).join('\n')}\n`);
      expect(rows).toEqual(documents.map((document) => referenceCells(document)));
    }
  });

  it('accepts a line exactly when JSON.parse reads it as an object', async () => {
    const next = random(7);
    const insertions = ['{', '}', '[', ']', ',', ':', '"', '\\', ' ', '\r', '\t', '0', '1', '-', '+', '.', 'e', 'E', 'u', 'n', 'x', '\u0000'];
    const lines: string[] = [];
    while (lines.length < 4_000) {
      const valid = JSON.stringify(generateDocument(next));
      const position = Math.floor(next() * (valid.length + 1));
      const mutation = Math.floor(next() * 3);
      const insert = insertions[Math.floor(next() * insertions.length)]!;
      const line =
        mutation === 0
          ? valid.slice(0, position) + valid.slice(position + 1)
          : valid.slice(0, position) + insert + valid.slice(position + (mutation === 1 ? 0 : 1));
      // Blank lines are skipped, so they would break the line-to-row pairing.
      if (line.trim()) {
        lines.push(line);
      }
    }
    const { rows } = await parse(`${lines.join('\n')}\n`);
    expect(rows).toHaveLength(lines.length);
    const mismatches = lines.filter((line, index) => isJsonObject(line) === (MALFORMED_LINE_COLUMN in rows[index]!));
    expect(mismatches).toEqual([]);
  });
});
