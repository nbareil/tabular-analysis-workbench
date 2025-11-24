import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataWorkerState } from './dataWorkerState';
import type { RowBatchStore } from '../rowBatchStore';
import type { TaggingStore } from '../taggingStore';
import type { TagRecord } from '../types';

const createMockBatchStore = (): RowBatchStore =>
  ({
    clear: vi.fn()
  } as unknown as RowBatchStore);

const createMockTaggingStore = () =>
  ({
    save: vi.fn().mockResolvedValue(undefined)
  }) as unknown as TaggingStore;

describe('dataWorkerState', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('initialises dataset state and resets after load lifecycle', () => {
    const state = createDataWorkerState();
    expect(state.dataset.batchStore).toBeNull();
    expect(state.dataset.totalRows).toBe(0);

    const batchStore = createMockBatchStore();
    state.prepareDatasetForLoad({
      batchStore,
      datasetKey: 'dataset-123',
      fileHandle: null
    });
    state.updateDataset((dataset) => {
      dataset.totalRows = 128;
      dataset.bytesParsed = 2048;
    });

    expect(state.dataset.batchStore).toBe(batchStore);
    expect(state.dataset.totalRows).toBe(128);

    state.resetDataset();
    expect(state.dataset.batchStore).toBeNull();
    expect(state.dataset.totalRows).toBe(0);
    expect(state.dataset.bytesParsed).toBe(0);
  });

  it('schedules tagging persistence when dirty', async () => {
    vi.useFakeTimers();
    const state = createDataWorkerState();
    const store = createMockTaggingStore();
    const tagRecord: TagRecord = {
      labelIds: ['abc'],
      updatedAt: Date.now()
    };

    state.updateTagging((tagging) => {
      tagging.store = store;
      tagging.labels = [
        {
          id: 'abc',
          name: 'Example',
          color: '#fff',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      tagging.tags = { 1: tagRecord };
    });

    state.markTaggingDirty();
    expect(state.tagging.dirty).toBe(true);
    expect(state.tagging.persistTimer).not.toBeNull();

    await vi.runOnlyPendingTimersAsync();

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(state.tagging.dirty).toBe(false);
  });
});
