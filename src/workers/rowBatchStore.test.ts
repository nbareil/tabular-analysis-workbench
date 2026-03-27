// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { RowBatchStore } from './rowBatchStore';
import type { RowBatch } from './types';

const textEncoder = new TextEncoder();

const toUint8Array = (source: BufferSource): Uint8Array => {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }

  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
};

class MockWritable {
  public writes: BufferSource[] = [];
  public closed = false;

  async write(data: unknown): Promise<void> {
    this.writes.push(data as BufferSource);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class MockFileHandle {
  public readonly writable = new MockWritable();

  async createWritable(): Promise<FileSystemWritableFileStream> {
    return this.writable as unknown as FileSystemWritableFileStream;
  }

  async getFile(): Promise<File> {
    const chunks = this.writable.writes.map(toUint8Array);
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const arrayBuffer = new ArrayBuffer(totalLength);
    const bytes = new Uint8Array(arrayBuffer);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      size: bytes.byteLength,
      arrayBuffer: async () => arrayBuffer.slice(0)
    } as unknown as File;
  }
}

class MockDirectoryHandle {
  private readonly handles = new Map<string, MockFileHandle>();

  async getFileHandle(name: string, _options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    let handle = this.handles.get(name);
    if (!handle) {
      handle = new MockFileHandle();
      this.handles.set(name, handle);
    }
    return handle as unknown as FileSystemFileHandle;
  }

  getMockHandle(name: string): MockFileHandle | undefined {
    return this.handles.get(name);
  }
}

const createStringBatch = (rowId: number, value: string): RowBatch => {
  const encoded = textEncoder.encode(value);
  const offsets = new Uint32Array(2);
  offsets[0] = 0;
  offsets[1] = encoded.byteLength;
  const data = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength
  );

  return {
    rowIds: new Uint32Array([rowId]),
    columns: {
      value: {
        type: 'string',
        offsets,
        data
      }
    },
    columnTypes: {
      value: 'string'
    },
    columnInference: {
      value: {
        type: 'string',
        confidence: 1,
        samples: 1,
        nullCount: 0,
        examples: [value]
      }
    },
    stats: {
      rowsParsed: rowId + 1,
      bytesParsed: encoded.byteLength,
      eof: false
    }
  };
};

describe('RowBatchStore memory fallback', () => {
  it('materializes rows from all batches even when exceeding the cache size', async () => {
    const store = await RowBatchStore.create('test-dataset');

    const requestedRows: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const batch = createStringBatch(index, `row-${index}`);
      await store.storeBatch(batch);
      requestedRows.push(index);
    }

    const rows = await store.materializeRows(requestedRows);
    expect(rows).toHaveLength(requestedRows.length);
    expect(rows.map((row) => row.__rowId)).toEqual(requestedRows);
    expect(rows.map((row) => row.value)).toEqual(requestedRows.map((index) => `row-${index}`));
  });
});

describe('RowBatchStore OPFS writes', () => {
  it('streams existing buffers without cloning and preserves null masks', async () => {
    const store = await RowBatchStore.create('opfs-dataset');
    const directoryHandle = new MockDirectoryHandle();
    (store as unknown as { useMemoryFallback: boolean }).useMemoryFallback = false;
    (store as unknown as { directoryHandle: FileSystemDirectoryHandle | null }).directoryHandle =
      directoryHandle as unknown as FileSystemDirectoryHandle;

    const rowIdsBuffer = new ArrayBuffer(32);
    const rowIds = new Uint32Array(rowIdsBuffer, 8, 2);
    rowIds.set([10, 11]);

    const stringOffsetsBuffer = new ArrayBuffer(32);
    const stringOffsets = new Uint32Array(stringOffsetsBuffer, 4, 3);
    stringOffsets.set([0, 4, 8]);
    const stringData = new ArrayBuffer(8);
    new Uint8Array(stringData).set([97, 98, 99, 100, 119, 120, 121, 122]);

    const numberDataBuffer = new ArrayBuffer(64);
    const numberData = new Float64Array(numberDataBuffer, Float64Array.BYTES_PER_ELEMENT, 2);
    numberData.set([1.5, 2.5]);

    const nullMaskBuffer = new ArrayBuffer(8);
    const nullMask = new Uint8Array(nullMaskBuffer, 1, 2);
    nullMask.set([0b00000001, 0b00000010]);

    const batch: RowBatch = {
      rowIds,
      columns: {
        label: {
          type: 'string',
          offsets: stringOffsets,
          data: stringData
        },
        value: {
          type: 'number',
          data: numberData,
          nullMask
        }
      },
      columnTypes: {
        label: 'string',
        value: 'number'
      },
      columnInference: {
        label: {
          type: 'string',
          confidence: 1,
          samples: 2,
          nullCount: 0,
          examples: []
        },
        value: {
          type: 'number',
          confidence: 1,
          samples: 2,
          nullCount: 0,
          examples: []
        }
      },
      stats: {
        rowsParsed: (rowIds[rowIds.length - 1] ?? 0) + 1,
        bytesParsed: 0,
        eof: false
      }
    };

    await store.storeBatch(batch);

    const handle = directoryHandle.getMockHandle('batch-000000.bin');
    expect(handle).toBeDefined();
    const writes = handle!.writable.writes;
    expect(writes).toHaveLength(7);

    const rowIdChunk = writes[2] as Uint8Array;
    expect(rowIdChunk.buffer).toBe(rowIds.buffer);
    expect(rowIdChunk.byteOffset).toBe(rowIds.byteOffset);
    expect(rowIdChunk.byteLength).toBe(rowIds.byteLength);

    const stringOffsetsChunk = writes[3] as Uint8Array;
    expect(stringOffsetsChunk.buffer).toBe(stringOffsets.buffer);
    expect(stringOffsetsChunk.byteOffset).toBe(stringOffsets.byteOffset);
    expect(stringOffsetsChunk.byteLength).toBe(stringOffsets.byteLength);

    const stringDataChunk = writes[4] as ArrayBuffer;
    expect(stringDataChunk).toBe(stringData);

    const numberDataChunk = writes[5] as Uint8Array;
    expect(numberDataChunk.buffer).toBe(numberData.buffer);
    expect(numberDataChunk.byteOffset).toBe(numberData.byteOffset);
    expect(numberDataChunk.byteLength).toBe(numberData.byteLength);

    const nullMaskChunk = writes[6] as Uint8Array;
    expect(nullMaskChunk.buffer).toBe(nullMask.buffer);
    expect(nullMaskChunk.byteOffset).toBe(nullMask.byteOffset);
    expect(nullMaskChunk.byteLength).toBe(nullMask.byteLength);
  });

  it('materializes evicted UTF-8 string batches correctly after disk reload', async () => {
    const store = await RowBatchStore.create('opfs-eviction-dataset');
    const directoryHandle = new MockDirectoryHandle();
    (store as unknown as { useMemoryFallback: boolean }).useMemoryFallback = false;
    (store as unknown as { directoryHandle: FileSystemDirectoryHandle | null }).directoryHandle =
      directoryHandle as unknown as FileSystemDirectoryHandle;

    const values = ['München', 'Québec', '東京', 'emoji 🚀', 'café crème'];

    for (let index = 0; index < values.length; index += 1) {
      await store.storeBatch(createStringBatch(index, values[index]!));
    }

    const rows = await store.materializeRows([0, 1, 2, 3, 4]);

    expect(rows.map((row) => row.__rowId)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.map((row) => row.value)).toEqual(values);
  });
});
