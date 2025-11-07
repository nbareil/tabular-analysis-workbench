import { logDebug } from '../utils/debugLog';
import { materializeRowBatch, type MaterializedRow } from './utils/materializeRowBatch';
import type { ColumnBatch, ColumnType, RowBatch } from './types';

const BATCH_STORE_VERSION = 1;
const MAX_IN_MEMORY_BATCHES = 4;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const cloneViewToArrayBuffer = (view: ArrayBufferView): ArrayBuffer => {
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return buffer;
};

const cloneArrayBuffer = (buffer: ArrayBuffer): ArrayBuffer => buffer.slice(0);

interface StoredColumnHeader {
  name: string;
  type: ColumnType;
  dataByteLength: number;
  offsetsByteLength?: number;
  nullMaskByteLength?: number;
}

interface StoredBatchHeader {
  version: number;
  rowStart: number;
  rowCount: number;
  columnOrder: string[];
  columns: StoredColumnHeader[];
}

interface BatchMeta {
  index: number;
  rowStart: number;
  rowCount: number;
  handle: FileSystemFileHandle | null;
}

interface CachedBatch {
  index: number;
  batch: RowBatch;
}

const supportsOpfs = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.storage !== 'undefined' &&
  typeof navigator.storage.getDirectory === 'function';

export class RowBatchStore {
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private readonly datasetKey: string;
  private metas: BatchMeta[] = [];
  private cache: CachedBatch[] = [];
  private useMemoryFallback: boolean = false;
  private memoryStore: Map<number, RowBatch> = new Map();

  private constructor(datasetKey: string) {
    this.datasetKey = datasetKey;
  }

  static async create(datasetKey: string): Promise<RowBatchStore> {
    const store = new RowBatchStore(datasetKey);

    if (!supportsOpfs()) {
      store.useMemoryFallback = true;
      return store;
    }

    try {
      const root = await navigator.storage.getDirectory();
      const baseDir = await root.getDirectoryHandle('row-cache', { create: true });

      // Clean up any previous dataset directory with the same key.
      try {
        await baseDir.removeEntry(datasetKey, { recursive: true });
      } catch (error) {
        // Ignored: directory may not exist yet.
      }

      store.directoryHandle = await baseDir.getDirectoryHandle(datasetKey, { create: true });
    } catch (error) {
      console.warn('[row-batch-store] Failed to initialise OPFS directory, falling back to memory', error);
      store.useMemoryFallback = true;
    }

    return store;
  }

  async clear(): Promise<void> {
    this.metas = [];
    this.cache = [];
    this.memoryStore = new Map();

    if (!this.directoryHandle) {
      return;
    }

    try {
      const parent = await navigator.storage.getDirectory();
      const baseDir = await parent.getDirectoryHandle('row-cache');
      await baseDir.removeEntry(this.datasetKey, { recursive: true });
      this.directoryHandle = await baseDir.getDirectoryHandle(this.datasetKey, { create: true });
    } catch (error) {
      console.warn('[row-batch-store] Failed to clear dataset directory', error);
    }
  }

  get batchCount(): number {
    return this.metas.length;
  }

  getBatchMeta(index: number): BatchMeta | undefined {
    return this.metas[index];
  }

  async storeBatch(batch: RowBatch): Promise<void> {
    const batchIndex = this.metas.length;
    const rowCount = batch.rowIds.length;
    const rowStart = rowCount > 0 ? batch.rowIds[0] : batchIndex === 0 ? 0 : this.metas[this.metas.length - 1]!.rowStart + this.metas[this.metas.length - 1]!.rowCount;

    if (this.useMemoryFallback || !this.directoryHandle) {
      this.metas.push({
        index: batchIndex,
        rowStart,
        rowCount,
        handle: null
      });

      this.memoryStore.set(batchIndex, batch);
      if (this.memoryStore.size > MAX_IN_MEMORY_BATCHES) {
        const oldestIndex = Math.min(...this.memoryStore.keys());
        this.memoryStore.delete(oldestIndex);
      }
      if (import.meta.env.DEV) {
        logDebug('row-batch-store', 'Stored batch in memory fallback', {
          batchIndex,
          rowStart,
          rowCount,
          cachedBatches: this.memoryStore.size
        });
      }
      return;
    }

    const fileName = `batch-${String(batchIndex).padStart(6, '0')}.bin`;
    const fileHandle = await this.directoryHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: false });

    const header: StoredBatchHeader = {
      version: BATCH_STORE_VERSION,
      rowStart,
      rowCount,
      columnOrder: Object.keys(batch.columns),
      columns: Object.entries(batch.columns).map(([name, column]): StoredColumnHeader => {
        switch (column.type) {
          case 'string': {
            const stringColumn = column as Extract<ColumnBatch, { type: 'string' }>;
            return {
              name,
              type: column.type,
              dataByteLength: stringColumn.data.byteLength,
              offsetsByteLength: stringColumn.offsets.byteLength,
              nullMaskByteLength: undefined
            };
          }
          case 'number': {
            const numberColumn = column as Extract<ColumnBatch, { type: 'number' }>;
            return {
              name,
              type: column.type,
              dataByteLength: numberColumn.data.byteLength,
              nullMaskByteLength: numberColumn.nullMask?.byteLength
            };
          }
          case 'boolean': {
            const booleanColumn = column as Extract<ColumnBatch, { type: 'boolean' }>;
            return {
              name,
              type: column.type,
              dataByteLength: booleanColumn.data.byteLength,
              nullMaskByteLength: booleanColumn.nullMask?.byteLength
            };
          }
          case 'datetime': {
            const datetimeColumn = column as Extract<ColumnBatch, { type: 'datetime' }>;
            return {
              name,
              type: column.type,
              dataByteLength: datetimeColumn.data.byteLength,
              nullMaskByteLength: datetimeColumn.nullMask?.byteLength
            };
          }
          default:
            throw new Error(`Unsupported column type: ${(column as ColumnBatch).type}`);
        }
      })
    };

    const headerBytes = textEncoder.encode(JSON.stringify(header));
    const headerLengthBuffer = new ArrayBuffer(4);
    new DataView(headerLengthBuffer).setUint32(0, headerBytes.byteLength, true);

    await writable.write(headerLengthBuffer);
    await writable.write(headerBytes);

    await writable.write(cloneViewToArrayBuffer(batch.rowIds));

    for (const columnName of header.columnOrder) {
      const column = batch.columns[columnName]!;

      if (column.type === 'string') {
        const stringColumn = column as Extract<ColumnBatch, { type: 'string' }>;
        await writable.write(cloneViewToArrayBuffer(stringColumn.offsets));
        await writable.write(cloneArrayBuffer(stringColumn.data));
      } else if (column.type === 'number') {
        const numberColumn = column as Extract<ColumnBatch, { type: 'number' }>;
        await writable.write(cloneViewToArrayBuffer(numberColumn.data));
      } else if (column.type === 'boolean') {
        const booleanColumn = column as Extract<ColumnBatch, { type: 'boolean' }>;
        await writable.write(cloneViewToArrayBuffer(booleanColumn.data));
      } else if (column.type === 'datetime') {
        const datetimeColumn = column as Extract<ColumnBatch, { type: 'datetime' }>;
        await writable.write(cloneViewToArrayBuffer(datetimeColumn.data));
      }

      if ('nullMask' in column && column.nullMask) {
        await writable.write(cloneViewToArrayBuffer(column.nullMask));
      }
    }

    await writable.close();

    this.metas.push({
      index: batchIndex,
      rowStart,
      rowCount,
      handle: fileHandle
    });

    this.cacheBatch({ index: batchIndex, batch });
    if (import.meta.env.DEV) {
      logDebug('row-batch-store', 'Stored batch on disk', {
        batchIndex,
        rowStart,
        rowCount,
        cacheSize: this.cache.length
      });
    }
  }

  private cacheBatch(entry: CachedBatch): void {
    this.cache = this.cache.filter((item) => item.index !== entry.index);
    this.cache.push(entry);

    if (this.cache.length > MAX_IN_MEMORY_BATCHES) {
      this.cache.shift();
    }
  }

  private async loadBatchFromDisk(meta: BatchMeta): Promise<RowBatch> {
    if (!meta.handle) {
      throw new Error('Batch handle not available; cannot load from disk.');
    }

    const file = await meta.handle.getFile();
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    const headerByteLength = view.getUint32(0, true);
    const headerBytes = new Uint8Array(buffer, 4, headerByteLength);
    const header: StoredBatchHeader = JSON.parse(textDecoder.decode(headerBytes));

    if (header.version !== BATCH_STORE_VERSION) {
      throw new Error(`Unsupported batch version: ${header.version}`);
    }

    let offset = 4 + headerByteLength;

    const rowIds = new Uint32Array(buffer.slice(offset, offset + header.rowCount * Uint32Array.BYTES_PER_ELEMENT));
    offset += header.rowCount * Uint32Array.BYTES_PER_ELEMENT;

    const columns: Record<string, ColumnBatch> = {};

    for (const columnHeader of header.columns) {
      if (columnHeader.type === 'string') {
        const offsetsByteLength = columnHeader.offsetsByteLength ?? (header.rowCount + 1) * Uint32Array.BYTES_PER_ELEMENT;
        const offsetsBuffer = buffer.slice(offset, offset + offsetsByteLength);
        offset += offsetsByteLength;

        const dataBuffer = buffer.slice(offset, offset + columnHeader.dataByteLength);
        offset += columnHeader.dataByteLength;

        const offsets = new Uint32Array(offsetsBuffer);

        columns[columnHeader.name] = {
          type: 'string',
          offsets,
          data: dataBuffer
        };
      } else if (columnHeader.type === 'number') {
        const dataBuffer = buffer.slice(offset, offset + columnHeader.dataByteLength);
        offset += columnHeader.dataByteLength;

        const nullMaskBuffer =
          columnHeader.nullMaskByteLength != null && columnHeader.nullMaskByteLength > 0
            ? buffer.slice(offset, offset + columnHeader.nullMaskByteLength)
            : null;

        if (nullMaskBuffer) {
          offset += columnHeader.nullMaskByteLength ?? 0;
        }

        columns[columnHeader.name] = {
          type: 'number',
          data: new Float64Array(dataBuffer),
          nullMask: nullMaskBuffer ? new Uint8Array(nullMaskBuffer) : undefined
        };
      } else if (columnHeader.type === 'boolean') {
        const dataBuffer = buffer.slice(offset, offset + columnHeader.dataByteLength);
        offset += columnHeader.dataByteLength;

        const nullMaskBuffer =
          columnHeader.nullMaskByteLength != null && columnHeader.nullMaskByteLength > 0
            ? buffer.slice(offset, offset + columnHeader.nullMaskByteLength)
            : null;

        if (nullMaskBuffer) {
          offset += columnHeader.nullMaskByteLength ?? 0;
        }

        columns[columnHeader.name] = {
          type: 'boolean',
          data: new Uint8Array(dataBuffer),
          nullMask: nullMaskBuffer ? new Uint8Array(nullMaskBuffer) : undefined
        };
      } else if (columnHeader.type === 'datetime') {
        const dataBuffer = buffer.slice(offset, offset + columnHeader.dataByteLength);
        offset += columnHeader.dataByteLength;

        const nullMaskBuffer =
          columnHeader.nullMaskByteLength != null && columnHeader.nullMaskByteLength > 0
            ? buffer.slice(offset, offset + columnHeader.nullMaskByteLength)
            : null;

        if (nullMaskBuffer) {
          offset += columnHeader.nullMaskByteLength ?? 0;
        }

        columns[columnHeader.name] = {
          type: 'datetime',
          data: new Float64Array(dataBuffer),
          nullMask: nullMaskBuffer ? new Uint8Array(nullMaskBuffer) : undefined
        };
      }
    }

    const batch: RowBatch = {
      rowIds,
      columns,
      columnTypes: {},
      columnInference: {},
      stats: {
        rowsParsed: meta.rowStart + meta.rowCount,
        bytesParsed: file.size,
        eof: true
      }
    };
    return batch;
  }

  private async ensureBatch(index: number): Promise<RowBatch> {
    const cached = this.cache.find((entry) => entry.index === index);
    if (cached) {
      return cached.batch;
    }

    if (this.useMemoryFallback) {
      const batch = this.memoryStore.get(index);
      if (!batch) {
        throw new Error(`Batch ${index} evicted due to memory limit; dataset too large for memory fallback`);
      }
      this.cacheBatch({ index, batch });
      return batch;
    }

    const meta = this.metas[index];
    if (!meta) {
      throw new Error(`Batch metadata not found for index ${index}`);
    }

    const batch = await this.loadBatchFromDisk(meta);
    this.cacheBatch({ index, batch });
    return batch;
  }

  async materializeRows(rowIds: number[]): Promise<MaterializedRow[]> {
    if (!rowIds.length) {
      return [];
    }

    if (import.meta.env.DEV) {
      logDebug('row-batch-store', 'materializeRows request', {
        rowCount: rowIds.length,
        firstRowId: rowIds[0],
        lastRowId: rowIds[rowIds.length - 1],
        batchCount: this.metas.length
      });
    }

    const rowMap = new Map<number, MaterializedRow>();
    const batchesByIndex = new Map<number, number[]>();

    for (const rowId of rowIds) {
      const batchIndex = this.findBatchIndexForRow(rowId);
      if (batchIndex == null) {
        continue;
      }
      const rowOffsets = batchesByIndex.get(batchIndex) ?? [];
      rowOffsets.push(rowId);
      batchesByIndex.set(batchIndex, rowOffsets);
    }

    for (const [batchIndex, rowIdList] of batchesByIndex.entries()) {
      const batch = await this.ensureBatch(batchIndex);
      const materialized = materializeRowBatch(batch).rows;

      for (const rowId of rowIdList) {
        const idx = rowId - batch.rowIds[0]!;
        if (idx >= 0 && idx < materialized.length) {
          rowMap.set(rowId, materialized[idx]!);
        }
      }
    }

    const orderedRows: MaterializedRow[] = [];
    for (const rowId of rowIds) {
      const row = rowMap.get(rowId);
      if (row) {
        orderedRows.push(row);
      }
    }

    if (import.meta.env.DEV) {
      logDebug('row-batch-store', 'materializeRows resolved', {
        requested: rowIds.length,
        resolved: orderedRows.length
      });
    }

    return orderedRows;
  }

  async materializeBatch(index: number): Promise<MaterializedRow[]> {
    const batch = await this.ensureBatch(index);
    return materializeRowBatch(batch).rows;
  }

  async *iterateMaterializedBatches(): AsyncGenerator<{
    index: number;
    rowStart: number;
    rows: MaterializedRow[];
  }> {
    for (const meta of this.metas) {
      const rows = await this.materializeBatch(meta.index);
      yield {
        index: meta.index,
        rowStart: meta.rowStart,
        rows
      };
    }
  }

  get totalRows(): number {
    if (!this.metas.length) {
      return 0;
    }

    const last = this.metas[this.metas.length - 1]!;
    return last.rowStart + last.rowCount;
  }

  private findBatchIndexForRow(rowId: number): number | null {
    if (!this.metas.length) {
      return null;
    }

    let low = 0;
    let high = this.metas.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const meta = this.metas[mid]!;

      if (rowId < meta.rowStart) {
        high = mid - 1;
        continue;
      }

      if (rowId >= meta.rowStart + meta.rowCount) {
        low = mid + 1;
        continue;
      }

      return mid;
    }

    return null;
  }

  async materializeRange(offset: number, limit: number): Promise<MaterializedRow[]> {
    if (limit <= 0) {
      return [];
    }

    const end = offset + limit;
    const rowIds: number[] = [];
    for (let index = offset; index < end; index += 1) {
      rowIds.push(index);
    }

    return this.materializeRows(rowIds);
  }
}
