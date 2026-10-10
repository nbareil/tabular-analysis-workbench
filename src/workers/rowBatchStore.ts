import type { ColumnBatch, RowBatch } from './types';

export const ROW_CACHE_DIRECTORY = 'row-cache';
const LOCK_PREFIX = 'row-cache:';
const MAX_CACHED_BATCHES = 8;
const MEMORY_FALLBACK_LIMIT_BYTES = 1024 * 1024 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface MaterializedRow extends Record<string, unknown> {
  __rowId: number;
}

/** Read access to one stored batch; columns are decoded lazily and memoised. */
export interface BatchView {
  rowStart: number;
  rowCount: number;
  /** One cell per row; empty cells are ''. */
  column(name: string): string[];
  /** Only the stored cells: `values[i]` belongs to batch row `rows[i]`, or to row `i` when `rows` is null. */
  cells(name: string): { rows: Uint32Array | null; values: string[] };
}

interface StoredBatchHeader {
  rowStart: number;
  rowCount: number;
  columns: Array<{ name: string; offsetsByteLength: number; dataByteLength: number; rowsByteLength: number }>;
}

interface BatchMeta {
  rowStart: number;
  rowCount: number;
  handle: FileSystemFileHandle | null;
  byteLength: number;
}

/** Bytes TextEncoder writes for `value`; it encodes a lone surrogate as U+FFFD (3 bytes). */
const utf8Length = (value: string): number => {
  let bytes = value.length;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      continue;
    }
    if (code < 0x800) {
      bytes += 1;
    } else if (code <= 0xdbff && code >= 0xd800 && (value.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
      bytes += 2;
      index += 1;
    } else {
      bytes += 2;
    }
  }
  return bytes;
};

const encodeEachCell = (values: string[]): ColumnBatch => {
  const cells = values.map((value) => textEncoder.encode(value));
  const offsets = new Uint32Array(values.length + 1);
  cells.forEach((cell, index) => {
    offsets[index + 1] = offsets[index]! + cell.byteLength;
  });
  const data = new Uint8Array(offsets[values.length]!);
  cells.forEach((cell, index) => data.set(cell, offsets[index]!));
  return { data: data.buffer, offsets };
};

/** Encodes one cell per row, with a single encoder call for the whole column when possible. */
export const encodeColumn = (values: string[]): ColumnBatch => {
  let joined: string;
  try {
    joined = values.join('');
  } catch {
    // Longer than the engine's maximum string length.
    return encodeEachCell(values);
  }
  const data = textEncoder.encode(joined);
  const offsets = new Uint32Array(values.length + 1);
  // Pure ASCII takes one byte per character.
  const ascii = data.byteLength === joined.length;
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += ascii ? values[index]!.length : utf8Length(values[index]!);
    offsets[index + 1] = total;
  }
  if (total !== data.byteLength) {
    // Lone surrogates ending one cell and starting the next became one character once joined.
    return encodeEachCell(values);
  }
  return { data: data.buffer.byteLength === data.byteLength ? data.buffer : data.slice().buffer, offsets };
};

/**
 * Encodes a column from its non-empty cells, `values[i]` being batch row `rows[i]` (ascending).
 * Columns that most rows lack are stored sparse; the others get '' for the missing rows.
 */
export const encodeSparseColumn = (rows: number[], values: string[], rowCount: number): ColumnBatch => {
  if (rows.length * 2 < rowCount) {
    return { ...encodeColumn(values), rows: Uint32Array.from(rows) };
  }
  const dense = new Array<string>(rowCount).fill('');
  rows.forEach((row, index) => {
    dense[row] = values[index]!;
  });
  return encodeColumn(dense);
};

const decodeColumn = (column: ColumnBatch): string[] => {
  const bytes = new Uint8Array(column.data);
  const valueCount = column.offsets.length - 1;
  const values = new Array<string>(valueCount);
  const text = textDecoder.decode(bytes);
  // Pure ASCII lets byte offsets double as string offsets, avoiding one decode per cell.
  if (text.length === bytes.byteLength) {
    for (let index = 0; index < valueCount; index += 1) {
      values[index] = text.slice(column.offsets[index]!, column.offsets[index + 1]!);
    }
    return values;
  }
  for (let index = 0; index < valueCount; index += 1) {
    values[index] = textDecoder.decode(bytes.subarray(column.offsets[index]!, column.offsets[index + 1]!));
  }
  return values;
};

/** Index of the stored value for a batch row, or -1 when a sparse column has nothing for it. */
const valueIndexOf = (column: ColumnBatch, row: number): number => {
  const rows = column.rows;
  if (!rows) {
    return row;
  }
  let low = 0;
  let high = rows.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (rows[mid]! < row) {
      low = mid + 1;
    } else if (rows[mid]! > row) {
      high = mid - 1;
    } else {
      return mid;
    }
  }
  return -1;
};

const decodeValue = (column: ColumnBatch, index: number): string =>
  textDecoder.decode(
    new Uint8Array(column.data, column.offsets[index]!, column.offsets[index + 1]! - column.offsets[index]!)
  );

const NO_ROWS = new Uint32Array(0);

const createBatchView = (rowStart: number, rowCount: number, columns: Record<string, ColumnBatch>): BatchView => {
  const stored = new Map<string, string[]>();
  const dense = new Map<string, string[]>();
  // Column names come from the file, so names such as "constructor" must not reach Object.prototype.
  const columnNamed = (name: string): ColumnBatch | undefined => (Object.hasOwn(columns, name) ? columns[name] : undefined);
  const storedValues = (name: string, column: ColumnBatch): string[] => {
    let values = stored.get(name);
    if (!values) {
      values = decodeColumn(column);
      stored.set(name, values);
    }
    return values;
  };
  return {
    rowStart,
    rowCount,
    column(name) {
      let values = dense.get(name);
      if (!values) {
        const column = columnNamed(name);
        if (column && !column.rows) {
          values = storedValues(name, column);
        } else {
          const all = new Array<string>(rowCount).fill('');
          if (column) {
            const sparse = storedValues(name, column);
            column.rows!.forEach((row, index) => {
              all[row] = sparse[index]!;
            });
          }
          values = all;
        }
        dense.set(name, values);
      }
      return values;
    },
    cells(name) {
      const column = columnNamed(name);
      return column ? { rows: column.rows ?? null, values: storedValues(name, column) } : { rows: NO_ROWS, values: [] };
    }
  };
};

const batchByteLength = (batch: RowBatch): number =>
  Object.values(batch.columns).reduce(
    (sum, column) => sum + column.data.byteLength + column.offsets.byteLength + (column.rows?.byteLength ?? 0),
    0
  );

const locksAvailable = (): boolean => typeof navigator !== 'undefined' && Boolean(navigator.locks);

/** Removes row-cache directories whose owning load no longer holds its Web Lock (closed tabs, old loads). */
const sweepStaleDirectories = async (baseDir: FileSystemDirectoryHandle): Promise<void> => {
  if (!locksAvailable()) {
    return;
  }
  const { held = [] } = await navigator.locks.query();
  const live = new Set(held.map((lock) => lock.name));
  const names: string[] = [];
  for await (const name of (baseDir as unknown as { keys(): AsyncIterable<string> }).keys()) {
    names.push(name);
  }
  for (const name of names) {
    if (!live.has(LOCK_PREFIX + name)) {
      await baseDir.removeEntry(name, { recursive: true }).catch(() => undefined);
    }
  }
};

export class RowBatchStore {
  private metas: BatchMeta[] = [];
  private readonly cache = new Map<number, Record<string, ColumnBatch>>();
  private memoryBytes = 0;

  private constructor(
    private readonly baseDir: FileSystemDirectoryHandle | null,
    private readonly directory: FileSystemDirectoryHandle | null,
    private readonly directoryName: string,
    private readonly releaseLock: () => void
  ) {}

  static async create(datasetKey: string): Promise<RowBatchStore> {
    const directoryName = `${datasetKey}-${crypto.randomUUID()}`;
    if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
      return new RowBatchStore(null, null, directoryName, () => undefined);
    }

    let releaseLock = (): void => undefined;
    if (locksAvailable()) {
      await new Promise<void>((acquired) => {
        void navigator.locks.request(LOCK_PREFIX + directoryName, () => {
          acquired();
          return new Promise<void>((release) => {
            releaseLock = release;
          });
        });
      });
    }

    const root = await navigator.storage.getDirectory();
    const baseDir = await root.getDirectoryHandle(ROW_CACHE_DIRECTORY, { create: true });
    await sweepStaleDirectories(baseDir);
    const directory = await baseDir.getDirectoryHandle(directoryName, { create: true });
    return new RowBatchStore(baseDir, directory, directoryName, releaseLock);
  }

  /** Deletes the stored batches and releases the directory lock. */
  async dispose(): Promise<void> {
    this.metas = [];
    this.cache.clear();
    this.releaseLock();
    await this.baseDir?.removeEntry(this.directoryName, { recursive: true }).catch(() => undefined);
  }

  get totalRows(): number {
    const last = this.metas[this.metas.length - 1];
    return last ? last.rowStart + last.rowCount : 0;
  }

  get batchCount(): number {
    return this.metas.length;
  }

  async storeBatch(batch: RowBatch): Promise<void> {
    const index = this.metas.length;
    const rowStart = this.totalRows;
    const rowCount = batch.rowIds.length;
    const byteLength = batchByteLength(batch);

    if (!this.directory) {
      this.memoryBytes += byteLength;
      if (this.memoryBytes > MEMORY_FALLBACK_LIMIT_BYTES) {
        throw new Error('Dataset is too large to hold in memory without the Origin Private File System.');
      }
      this.metas.push({ rowStart, rowCount, handle: null, byteLength });
      this.cache.set(index, batch.columns);
      return;
    }

    const names = Object.keys(batch.columns);
    const header: StoredBatchHeader = {
      rowStart,
      rowCount,
      columns: names.map((name) => ({
        name,
        offsetsByteLength: batch.columns[name]!.offsets.byteLength,
        dataByteLength: batch.columns[name]!.data.byteLength,
        rowsByteLength: batch.columns[name]!.rows?.byteLength ?? 0
      }))
    };
    const headerBytes = textEncoder.encode(JSON.stringify(header));
    const prefix = new Uint32Array([headerBytes.byteLength]);
    const parts: BlobPart[] = [prefix as Uint32Array<ArrayBuffer>, headerBytes];
    for (const name of names) {
      const { offsets, data, rows } = batch.columns[name]!;
      parts.push(offsets as Uint32Array<ArrayBuffer>, data);
      if (rows) {
        parts.push(rows as Uint32Array<ArrayBuffer>);
      }
    }

    const handle = await this.directory.getFileHandle(`batch-${String(index).padStart(6, '0')}.bin`, {
      create: true
    });
    const writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(new Blob(parts));
    await writable.close();

    this.metas.push({ rowStart, rowCount, handle, byteLength });
    this.remember(index, batch.columns);
  }

  private remember(index: number, columns: Record<string, ColumnBatch>): void {
    if (!this.directory) {
      return;
    }
    this.cache.delete(index);
    this.cache.set(index, columns);
    if (this.cache.size > MAX_CACHED_BATCHES) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }

  private async loadColumns(index: number): Promise<Record<string, ColumnBatch>> {
    const cached = this.cache.get(index);
    if (cached) {
      this.remember(index, cached);
      return cached;
    }

    const meta = this.metas[index];
    if (!meta?.handle) {
      throw new Error(`Batch ${index} is not available`);
    }

    const buffer = await (await meta.handle.getFile()).arrayBuffer();
    const headerLength = new DataView(buffer).getUint32(0, true);
    const header: StoredBatchHeader = JSON.parse(textDecoder.decode(new Uint8Array(buffer, 4, headerLength)));
    let offset = 4 + headerLength;
    const columns: Record<string, ColumnBatch> = {};
    for (const column of header.columns) {
      const offsets = new Uint32Array(buffer.slice(offset, offset + column.offsetsByteLength));
      offset += column.offsetsByteLength;
      const data = buffer.slice(offset, offset + column.dataByteLength);
      offset += column.dataByteLength;
      columns[column.name] = { offsets, data };
      if (column.rowsByteLength) {
        columns[column.name]!.rows = new Uint32Array(buffer.slice(offset, offset + column.rowsByteLength));
        offset += column.rowsByteLength;
      }
    }

    this.remember(index, columns);
    return columns;
  }

  async *iterateBatches(): AsyncGenerator<BatchView> {
    for (let index = 0; index < this.metas.length; index += 1) {
      const meta = this.metas[index]!;
      yield createBatchView(meta.rowStart, meta.rowCount, await this.loadColumns(index));
    }
  }

  private findBatchIndex(rowId: number): number {
    let low = 0;
    let high = this.metas.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const meta = this.metas[mid]!;
      if (rowId < meta.rowStart) {
        high = mid - 1;
      } else if (rowId >= meta.rowStart + meta.rowCount) {
        low = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  /** Returns rows in the requested order, decoding only the requested cells. Rows omit cells a sparse column lacks. */
  async getRows(rowIds: ArrayLike<number>): Promise<MaterializedRow[]> {
    const byBatch = new Map<number, number[]>();
    for (let position = 0; position < rowIds.length; position += 1) {
      const batchIndex = this.findBatchIndex(rowIds[position]!);
      if (batchIndex !== -1) {
        const positions = byBatch.get(batchIndex) ?? [];
        positions.push(position);
        byBatch.set(batchIndex, positions);
      }
    }

    const rows = new Array<MaterializedRow | undefined>(rowIds.length);
    for (const [batchIndex, positions] of byBatch) {
      const columns = await this.loadColumns(batchIndex);
      const rowStart = this.metas[batchIndex]!.rowStart;
      const entries = Object.entries(columns);
      for (const position of positions) {
        const rowId = rowIds[position]!;
        const row: MaterializedRow = { __rowId: rowId };
        for (const [name, column] of entries) {
          const index = valueIndexOf(column, rowId - rowStart);
          if (index !== -1) {
            row[name] = decodeValue(column, index);
          }
        }
        rows[position] = row;
      }
    }
    return rows.filter((row): row is MaterializedRow => row !== undefined);
  }
}
