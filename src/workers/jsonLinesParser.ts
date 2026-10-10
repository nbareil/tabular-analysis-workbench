import { claimColumnName, DEFAULT_BATCH_SIZE, type ParserCallbacks, type ParserOptions } from './csvParser';
import { encodeSparseColumn } from './rowBatchStore';
import { TypeInferencer } from './typeInference';
import type { ColumnBatch } from './types';
import { detachString } from './utils/stringUtils';

/** Holds the text of lines that are not a JSON object. */
export const MALFORMED_LINE_COLUMN = 'malformed_line';
/** Holds the values whose path got no column of its own, as a JSON object of path → cell text. */
export const OTHER_FIELDS_COLUMN = 'other_fields';
/** Columns one file's keys may create (Elasticsearch's default field limit). */
export const MAX_JSON_COLUMNS = 1_000;
/** Objects nested deeper keep their JSON text in one cell (Elasticsearch's default depth limit). */
export const MAX_FLATTEN_DEPTH = 20;

const NO_COLUMN = -1;
const OTHER_FIELDS = -2;

const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const QUOTE = 34;
const PLUS = 43;
const COMMA = 44;
const MINUS = 45;
const DOT = 46;
const DIGIT_0 = 48;
const DIGIT_1 = 49;
const DIGIT_9 = 57;
const COLON = 58;
const UPPER_E = 69;
const OPEN_BRACKET = 91;
const BACKSLASH = 92;
const CLOSE_BRACKET = 93;
const LOWER_E = 101;
const LOWER_F = 102;
const LOWER_N = 110;
const LOWER_T = 116;
const LOWER_U = 117;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;

const ESCAPED_CHARACTERS: Record<number, string> = {
  34: '"',
  47: '/',
  92: '\\',
  98: '\b',
  102: '\f',
  110: '\n',
  114: '\r',
  116: '\t'
};

const isDigit = (code: number): boolean => code >= DIGIT_0 && code <= DIGIT_9;

const hexValue = (code: number): number => {
  if (code >= DIGIT_0 && code <= DIGIT_9) {
    return code - DIGIT_0;
  }
  const lower = code | 0x20;
  return lower >= 97 && lower <= 102 ? lower - 87 : -1;
};

/** A key path seen in the file. Children keep first-seen order, which becomes the column order. */
class PathNode {
  readonly children = new Map<string, PathNode>();
  /** Index of the path's column; NO_COLUMN until it has a value, OTHER_FIELDS past MAX_JSON_COLUMNS. */
  column = NO_COLUMN;

  constructor(
    readonly parent: PathNode | null,
    readonly key: string
  ) {}

  get path(): string {
    return this.parent?.parent ? `${this.parent.path}.${this.key}` : this.key;
  }
}

class MalformedLineError extends Error {}
// Thrown for every malformed line, so it is allocated once.
const MALFORMED = new MalformedLineError('Not a JSON object');

/**
 * Flattens a line holding one JSON object into (path, cell text) pairs in a single pass. Nested
 * objects become paths; arrays, and objects deeper than MAX_FLATTEN_DEPTH, keep their JSON text;
 * strings are unescaped; numbers and booleans keep their literal text, so long integers keep every
 * digit; null is empty. Accepts exactly what JSON.parse accepts.
 */
class LineFlattener {
  /** Pairs of the last line: `values[i]` is the cell text for `paths[i]`. */
  readonly paths: PathNode[] = [];
  readonly values: string[] = [];
  count = 0;
  /** Once set, keys never seen before get nodes outside the tree, so the tree stops growing. */
  frozen = false;
  private text = '';
  private position = 0;

  constructor(private readonly root: PathNode) {}

  /** Returns false, with no pairs, when the line is not exactly one JSON object. */
  flatten(line: string): boolean {
    this.text = line;
    this.position = 0;
    this.count = 0;
    try {
      this.skipWhitespace();
      if (line.charCodeAt(this.position) !== OPEN_BRACE) {
        throw MALFORMED;
      }
      this.readObject(this.root, 1);
      this.skipWhitespace();
      if (this.position !== line.length) {
        throw MALFORMED;
      }
      return true;
    } catch (error) {
      if (error !== MALFORMED) {
        throw error;
      }
      this.count = 0;
      return false;
    }
  }

  private emit(node: PathNode, value: string): void {
    this.paths[this.count] = node;
    this.values[this.count] = value;
    this.count += 1;
  }

  private child(node: PathNode, key: string): PathNode {
    let child = node.children.get(key);
    if (!child) {
      child = new PathNode(node, detachString(key));
      if (!this.frozen) {
        node.children.set(child.key, child);
      }
    }
    return child;
  }

  private skipWhitespace(): void {
    const text = this.text;
    let position = this.position;
    for (;;) {
      const code = text.charCodeAt(position);
      if (code !== SPACE && code !== TAB && code !== LF && code !== CR) {
        break;
      }
      position += 1;
    }
    this.position = position;
  }

  /** Reads the members of the object whose `{` is at the current position. */
  private readObject(node: PathNode, depth: number): void {
    const text = this.text;
    this.position += 1;
    this.skipWhitespace();
    if (text.charCodeAt(this.position) === CLOSE_BRACE) {
      this.position += 1;
      // An empty nested object keeps its key visible.
      if (node !== this.root) {
        this.emit(node, '{}');
      }
      return;
    }
    for (;;) {
      if (text.charCodeAt(this.position) !== QUOTE) {
        throw MALFORMED;
      }
      const key = this.readString();
      this.skipWhitespace();
      if (text.charCodeAt(this.position) !== COLON) {
        throw MALFORMED;
      }
      this.position += 1;
      this.readValue(this.child(node, key), depth);
      this.skipWhitespace();
      const code = text.charCodeAt(this.position);
      this.position += 1;
      if (code === CLOSE_BRACE) {
        return;
      }
      if (code !== COMMA) {
        throw MALFORMED;
      }
      this.skipWhitespace();
    }
  }

  private readValue(node: PathNode, depth: number): void {
    this.skipWhitespace();
    const start = this.position;
    switch (this.text.charCodeAt(start)) {
      case QUOTE:
        this.emit(node, this.readString());
        return;
      case OPEN_BRACE:
        if (depth < MAX_FLATTEN_DEPTH) {
          this.readObject(node, depth + 1);
          return;
        }
        this.skipValue();
        this.emit(node, this.text.slice(start, this.position));
        return;
      case OPEN_BRACKET:
        this.skipValue();
        this.emit(node, this.text.slice(start, this.position));
        return;
      case LOWER_T:
        this.expectWord('true');
        this.emit(node, 'true');
        return;
      case LOWER_F:
        this.expectWord('false');
        this.emit(node, 'false');
        return;
      case LOWER_N:
        this.expectWord('null');
        this.emit(node, '');
        return;
      default:
        this.emit(node, this.readNumber());
    }
  }

  /** Moves past one value, validating it without recursion so nesting depth cannot exhaust the stack. */
  private skipValue(): void {
    const text = this.text;
    const closers: number[] = [];
    for (;;) {
      this.skipWhitespace();
      const code = text.charCodeAt(this.position);
      if (code === OPEN_BRACE || code === OPEN_BRACKET) {
        const closer = code === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET;
        this.position += 1;
        this.skipWhitespace();
        if (text.charCodeAt(this.position) !== closer) {
          closers.push(closer);
          if (closer === CLOSE_BRACE) {
            this.skipKey();
          }
          continue;
        }
        this.position += 1;
      } else if (code === QUOTE) {
        this.readString();
      } else if (code === LOWER_T) {
        this.expectWord('true');
      } else if (code === LOWER_F) {
        this.expectWord('false');
      } else if (code === LOWER_N) {
        this.expectWord('null');
      } else {
        this.readNumber();
      }

      // A value ended: close finished containers, or move on to the next member.
      for (;;) {
        if (closers.length === 0) {
          return;
        }
        this.skipWhitespace();
        const next = text.charCodeAt(this.position);
        const closer = closers[closers.length - 1]!;
        this.position += 1;
        if (next === COMMA) {
          if (closer === CLOSE_BRACE) {
            this.skipWhitespace();
            this.skipKey();
          }
          break;
        }
        if (next !== closer) {
          throw MALFORMED;
        }
        closers.pop();
      }
    }
  }

  /** Moves past `"key" :`. */
  private skipKey(): void {
    if (this.text.charCodeAt(this.position) !== QUOTE) {
      throw MALFORMED;
    }
    this.readString();
    this.skipWhitespace();
    if (this.text.charCodeAt(this.position) !== COLON) {
      throw MALFORMED;
    }
    this.position += 1;
  }

  /** Reads the string whose opening quote is at the current position and returns it unescaped. */
  private readString(): string {
    const text = this.text;
    const start = this.position + 1;
    for (let index = start; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === QUOTE) {
        this.position = index + 1;
        return text.slice(start, index);
      }
      if (code === BACKSLASH) {
        return this.readEscapedString(start, index);
      }
      if (code < SPACE) {
        throw MALFORMED;
      }
    }
    throw MALFORMED;
  }

  private readEscapedString(start: number, backslash: number): string {
    const text = this.text;
    let value = '';
    let segmentStart = start;
    let index = backslash;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === QUOTE) {
        this.position = index + 1;
        return value + text.slice(segmentStart, index);
      }
      if (code === BACKSLASH) {
        value += text.slice(segmentStart, index);
        const escape = text.charCodeAt(index + 1);
        if (escape === LOWER_U) {
          const unit =
            (hexValue(text.charCodeAt(index + 2)) << 12) |
            (hexValue(text.charCodeAt(index + 3)) << 8) |
            (hexValue(text.charCodeAt(index + 4)) << 4) |
            hexValue(text.charCodeAt(index + 5));
          // A missing or non-hex digit is -1, which makes the combined value negative.
          if (unit < 0) {
            throw MALFORMED;
          }
          value += String.fromCharCode(unit);
          index += 6;
        } else {
          const character = ESCAPED_CHARACTERS[escape];
          if (character === undefined) {
            throw MALFORMED;
          }
          value += character;
          index += 2;
        }
        segmentStart = index;
      } else if (code < SPACE) {
        throw MALFORMED;
      } else {
        index += 1;
      }
    }
    throw MALFORMED;
  }

  /** Reads a number and returns its literal text. */
  private readNumber(): string {
    const text = this.text;
    const start = this.position;
    let index = start;
    if (text.charCodeAt(index) === MINUS) {
      index += 1;
    }
    let code = text.charCodeAt(index);
    if (code === DIGIT_0) {
      index += 1;
    } else if (code >= DIGIT_1 && code <= DIGIT_9) {
      do {
        index += 1;
      } while (isDigit(text.charCodeAt(index)));
    } else {
      throw MALFORMED;
    }
    if (text.charCodeAt(index) === DOT) {
      index += 1;
      if (!isDigit(text.charCodeAt(index))) {
        throw MALFORMED;
      }
      do {
        index += 1;
      } while (isDigit(text.charCodeAt(index)));
    }
    code = text.charCodeAt(index);
    if (code === LOWER_E || code === UPPER_E) {
      index += 1;
      code = text.charCodeAt(index);
      if (code === PLUS || code === MINUS) {
        index += 1;
      }
      if (!isDigit(text.charCodeAt(index))) {
        throw MALFORMED;
      }
      do {
        index += 1;
      } while (isDigit(text.charCodeAt(index)));
    }
    this.position = index;
    return text.slice(start, index);
  }

  private expectWord(word: string): void {
    if (!this.text.startsWith(word, this.position)) {
      throw MALFORMED;
    }
    this.position += word.length;
  }
}

/**
 * Streams JSON Lines into batches: one row per line holding a JSON object, keys flattened into
 * dotted column paths. Columns appear in path order and grow as new keys turn up, each reported
 * through `onColumns` before the batch that first uses it. Blank lines are skipped; any other line
 * that is not a JSON object becomes a row holding its text in MALFORMED_LINE_COLUMN and counts as
 * malformed. Batches store only the cells a row has, so rare keys cost nothing elsewhere.
 */
export const parseJsonLinesStream = async (
  source: AsyncIterable<Uint8Array>,
  callbacks: ParserCallbacks,
  options: ParserOptions = {}
): Promise<void> => {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const decoder = new TextDecoder(options.encoding ?? 'utf-8');
  const usedNames = new Set(options.reservedColumns);
  const root = new PathNode(null, '');
  const flattener = new LineFlattener(root);
  const inferencer = new TypeInferencer();

  const columnNames: string[] = [];
  // Cells of the pending batch: `cellValues[column][i]` belongs to batch row `cellRows[column][i]`.
  let cellRows: number[][] = [];
  let cellValues: string[][] = [];
  let jsonColumns = 0;
  let malformedLineColumn = NO_COLUMN;
  let otherFieldsColumn = NO_COLUMN;
  let reportedColumns = 0;
  let pendingRows = 0;
  let totalRows = 0;
  let bytesParsed = 0;
  let malformedRows = 0;
  let partialLine = '';

  const addColumn = (base: string): number => {
    const name = claimColumnName(base, usedNames);
    columnNames.push(name);
    inferencer.addColumn(name);
    cellRows.push([]);
    cellValues.push([]);
    return columnNames.length - 1;
  };

  /** Column names in path order, so related keys sit together however late they first appear. */
  const orderedColumns = (): string[] => {
    const ordered: string[] = [];
    const visit = (node: PathNode): void => {
      if (node.column >= 0) {
        ordered.push(columnNames[node.column]!);
      }
      node.children.forEach(visit);
    };
    visit(root);
    for (const column of [malformedLineColumn, otherFieldsColumn]) {
      if (column !== NO_COLUMN) {
        ordered.push(columnNames[column]!);
      }
    }
    return ordered;
  };

  const putCell = (column: number, value: string): void => {
    const rows = cellRows[column]!;
    const values = cellValues[column]!;
    const last = rows.length - 1;
    if (last >= 0 && rows[last] === pendingRows) {
      // A repeated key keeps its last value, as with JSON.parse.
      if (value) {
        values[last] = value;
      } else {
        rows.pop();
        values.pop();
      }
    } else if (value) {
      rows.push(pendingRows);
      values.push(value);
    }
  };

  const assignColumn = (node: PathNode): void => {
    if (jsonColumns === MAX_JSON_COLUMNS) {
      node.column = OTHER_FIELDS;
      flattener.frozen = true;
      return;
    }
    jsonColumns += 1;
    const path = node.path;
    node.column = addColumn(path.trim() ? path : `column_${columnNames.length + 1}`);
  };

  const addRecord = (): void => {
    let otherFields: Map<string, string> | null = null;
    for (let index = 0; index < flattener.count; index += 1) {
      const node = flattener.paths[index]!;
      const value = flattener.values[index]!;
      if (node.column === NO_COLUMN) {
        assignColumn(node);
      }
      if (node.column !== OTHER_FIELDS) {
        putCell(node.column, value);
      } else if (value) {
        (otherFields ??= new Map()).set(node.path, value);
      } else {
        otherFields?.delete(node.path);
      }
    }
    if (otherFields?.size) {
      if (otherFieldsColumn === NO_COLUMN) {
        otherFieldsColumn = addColumn(OTHER_FIELDS_COLUMN);
      }
      const members = Array.from(otherFields, ([path, value]) => `${JSON.stringify(path)}:${JSON.stringify(value)}`);
      putCell(otherFieldsColumn, `{${members.join(',')}}`);
    }
  };

  const addLine = (line: string): void => {
    if (flattener.flatten(line)) {
      addRecord();
    } else {
      if (!line.trim()) {
        return;
      }
      malformedRows += 1;
      if (malformedLineColumn === NO_COLUMN) {
        malformedLineColumn = addColumn(MALFORMED_LINE_COLUMN);
      }
      putCell(malformedLineColumn, line.endsWith('\r') ? line.slice(0, -1) : line);
    }
    pendingRows += 1;
  };

  const flushBatch = async (eof: boolean): Promise<void> => {
    if (pendingRows === 0) {
      return;
    }
    if (columnNames.length > reportedColumns) {
      reportedColumns = columnNames.length;
      await callbacks.onColumns?.(orderedColumns());
    }
    const columns: Record<string, ColumnBatch> = {};
    cellRows.forEach((rows, column) => {
      if (rows.length > 0) {
        const values = cellValues[column]!;
        columns[columnNames[column]!] = encodeSparseColumn(rows, values, pendingRows);
        values.forEach((value) => inferencer.updateCell(column, value));
      }
    });
    inferencer.addRows(pendingRows);
    cellRows = columnNames.map(() => []);
    cellValues = columnNames.map(() => []);

    const rowIds = new Uint32Array(pendingRows);
    for (let index = 0; index < pendingRows; index += 1) {
      rowIds[index] = totalRows + index;
    }
    totalRows += pendingRows;
    pendingRows = 0;
    const { columnTypes, columnInference } = inferencer.resolveAll();
    await callbacks.onBatch({
      rowIds,
      columns,
      columnTypes,
      columnInference,
      stats: { rowsParsed: totalRows, bytesParsed, malformedRows, eof }
    });
  };

  const consume = async (text: string): Promise<void> => {
    let newline = text.indexOf('\n');
    if (newline === -1) {
      partialLine += text;
      return;
    }
    addLine(partialLine + text.slice(0, newline));
    let start = newline + 1;
    while ((newline = text.indexOf('\n', start)) !== -1) {
      if (pendingRows >= batchSize) {
        await flushBatch(false);
      }
      addLine(text.slice(start, newline));
      start = newline + 1;
    }
    partialLine = text.slice(start);
    if (pendingRows >= batchSize) {
      await flushBatch(false);
    }
  };

  for await (const chunk of source) {
    bytesParsed += chunk.byteLength;
    const text = decoder.decode(chunk, { stream: true });
    if (text.length > 0) {
      await consume(text);
    }
  }
  partialLine += decoder.decode();
  if (pendingRows >= batchSize) {
    await flushBatch(false);
  }
  addLine(partialLine);
  partialLine = '';
  await flushBatch(true);
};
