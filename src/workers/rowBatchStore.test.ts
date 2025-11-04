import { describe, expect, it } from 'vitest';

import { RowBatchStore } from './rowBatchStore';
import type { RowBatch } from './types';

const textEncoder = new TextEncoder();

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
