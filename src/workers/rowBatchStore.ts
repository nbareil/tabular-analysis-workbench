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
  column(name: string): string[];
}

interface StoredBatchHeader {
  rowStart: number;
  rowCount: number;
  columns: Array<{ name: string; offsetsByteLength: number; dataByteLength: number }>;
}

interface BatchMeta {
  rowStart: number;
  rowCount: number;
  handle: FileSystemFileHandle | null;
  byteLength: number;
}

const decodeColumn = (column: ColumnBatch): string[] => {
  const bytes = new Uint8Array(column.data);
  const rowCount = column.offsets.length - 1;
  const values = new Array<string>(rowCount);
  const text = textDecoder.decode(bytes);
  // Pure ASCII lets byte offsets double as string offsets, avoiding one decode per cell.
  if (text.length === bytes.byteLength) {
    for (let index = 0; index < rowCount; index += 1) {
      values[index] = text.slice(column.offsets[index]!, column.offsets[index + 1]!);
    }
    return values;
  }
  for (let index = 0; index < rowCount; index += 1) {
    values[index] = textDecoder.decode(bytes.subarray(column.offsets[index]!, column.offsets[index + 1]!));
  }
  return values;
};

const decodeCell = (column: ColumnBatch, index: number): string =>
  textDecoder.decode(
    new Uint8Array(column.data, column.offsets[index]!, column.offsets[index + 1]! - column.offsets[index]!)
  );

const createBatchView = (rowStart: number, rowCount: number, columns: Record<string, ColumnBatch>): BatchView => {
  const decoded = new Map<string, string[]>();
  return {
    rowStart,
    rowCount,
    column(name) {
      let values = decoded.get(name);
      if (!values) {
        const column = columns[name];
        values = column ? decodeColumn(column) : new Array<string>(rowCount).fill('');
        decoded.set(name, values);
      }
      return values;
    }
  };
};

const batchByteLength = (batch: RowBatch): number =>
  Object.values(batch.columns).reduce((sum, column) => sum + column.data.byteLength + column.offsets.byteLength, 0);

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
        dataByteLength: batch.columns[name]!.data.byteLength
      }))
    };
    const headerBytes = textEncoder.encode(JSON.stringify(header));
    const prefix = new Uint32Array([headerBytes.byteLength]);
    const parts: BlobPart[] = [prefix as Uint32Array<ArrayBuffer>, headerBytes];
    for (const name of names) {
      parts.push(batch.columns[name]!.offsets as Uint32Array<ArrayBuffer>, batch.columns[name]!.data);
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

  /** Returns rows in the requested order, decoding only the requested cells. */
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
          row[name] = decodeCell(column, rowId - rowStart);
        }
        rows[position] = row;
      }
    }
    return rows.filter((row): row is MaterializedRow => row !== undefined);
  }
}
