import { describe, expect, it } from 'vitest';

import { createTimelineController, resolveTimelineBucketSpec } from './timelineController';
import { createDataWorkerState } from '../state/dataWorkerState';
import type { FilterNode, RowBatch, StringColumnBatch } from '../types';

const textEncoder = new TextEncoder();

const createStringColumn = (values: string[]): StringColumnBatch => {
  const encodedValues = values.map((value) => textEncoder.encode(value));
  const offsets = new Uint32Array(values.length + 1);
  let totalLength = 0;
  encodedValues.forEach((value, index) => {
    offsets[index] = totalLength;
    totalLength += value.byteLength;
  });
  offsets[values.length] = totalLength;

  const buffer = new ArrayBuffer(offsets.byteLength + totalLength);
  const storedOffsets = new Uint32Array(buffer, 0, offsets.length);
  storedOffsets.set(offsets);
  const dataView = new Uint8Array(buffer, offsets.byteLength);
  let cursor = 0;
  for (const encoded of encodedValues) {
    dataView.set(encoded, cursor);
    cursor += encoded.byteLength;
  }

  return {
    type: 'string',
    offsets: storedOffsets,
    data: buffer
  };
};

const createBatch = (): RowBatch => ({
  rowIds: new Uint32Array([0, 1, 2]),
  columns: {
    Timestamp: {
      type: 'datetime',
      data: new Float64Array([0, 60_000, 120_000])
    },
    Category: createStringColumn(['auth', 'network', 'auth'])
  },
  columnTypes: {
    Timestamp: 'datetime',
    Category: 'string'
  },
  columnInference: {
    Timestamp: {
      type: 'datetime',
      confidence: 1,
      samples: 3,
      nullCount: 0,
      examples: [],
      minDatetime: 0,
      maxDatetime: 120_000
    },
    Category: {
      type: 'string',
      confidence: 1,
      samples: 3,
      nullCount: 0,
      examples: ['auth']
    }
  },
  stats: {
    rowsParsed: 3,
    bytesParsed: 0,
    eof: true
  }
});

describe('timelineController', () => {
  it('chooses an in-family step size that keeps the bucket count bounded', () => {
    const bucketSpec = resolveTimelineBucketSpec(
      0,
      3 * 60 * 1000,
      60_000,
      120_000
    );

    expect(bucketSpec.family).toBe('seconds');
    expect(bucketSpec.step).toBe(5);
    expect(bucketSpec.bucketCount).toBeLessThanOrEqual(120);
  });

  it('aggregates matching rows into timeline buckets', async () => {
    const state = createDataWorkerState();
    state.updateDataset((dataset) => {
      dataset.batchStore = {
        iterateBatches: async function* () {
          yield {
            index: 0,
            rowStart: 0,
            batch: createBatch()
          };
        }
      } as unknown as typeof dataset.batchStore;
      dataset.columnTypes = {
        Timestamp: 'datetime',
        Category: 'string'
      };
    });

    const controller = createTimelineController({ state });
    const expression: FilterNode = {
      column: 'Category',
      operator: 'eq',
      value: 'auth',
      id: 'category-auth'
    };

    const result = await controller.run({
      column: 'Timestamp',
      expression,
      rangeStart: 0,
      rangeEnd: 180_000
    });

    expect(result.totalMatchingRows).toBe(2);
    expect(result.bucketFamily).toBe('seconds');
    expect(result.bucketStep).toBe(5);
    expect(result.buckets[0]?.count).toBe(1);
    expect(result.buckets[12]?.count).toBe(0);
    expect(result.buckets[24]?.count).toBe(1);
  });
});
