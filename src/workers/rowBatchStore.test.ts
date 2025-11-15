import { describe, expect, it } from 'vitest';

import { RowBatchStore } from './rowBatchStore';
import type { RowBatch } from './types';

const textEncoder = new TextEncoder();

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
  const rowCount = 1;
  const buffer = new ArrayBuffer((rowCount + 1) * Uint32Array.BYTES_PER_ELEMENT + encoded.byteLength);
  const offsets = new Uint32Array(buffer, 0, rowCount + 1);
  offsets[0] = 0;
  offsets[1] = encoded.byteLength;
  const dataView = new Uint8Array(buffer, offsets.byteLength);
  dataView.set(encoded);

  return {
    rowIds: new Uint32Array([rowId]),
    columns: {
      value: {
        type: 'string',
        offsets,
        data: buffer
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
});
