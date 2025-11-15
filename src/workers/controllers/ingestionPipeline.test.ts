import { describe, expect, it, vi } from 'vitest';

import { createIngestionPipeline } from './ingestionPipeline';
import { createDataWorkerState } from '../state/dataWorkerState';
import type { RowBatchStore } from '../rowBatchStore';
import type { LoadFileRequest } from '../workerApiTypes';

describe('ingestionPipeline', () => {
  it('clears existing dataset and tagging state', async () => {
    const state = createDataWorkerState();
    const batchStore = {
      clear: vi.fn().mockResolvedValue(undefined)
    } as unknown as RowBatchStore;
    state.prepareDatasetForLoad({
      batchStore,
      datasetKey: 'test',
      fileHandle: null
    });

    state.updateTagging((tagging) => {
      tagging.labels = [
        {
          id: 'label',
          name: 'Example',
          color: '#fff',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      tagging.tags = {
        1: {
          labelId: 'label',
          updatedAt: Date.now()
        }
      };
    });

    const pipeline = createIngestionPipeline({ state });
    await pipeline.clear();

    expect(batchStore.clear).toHaveBeenCalledTimes(1);
    expect(state.dataset.batchStore).toBeNull();
    expect(state.tagging.labels).toHaveLength(0);
    expect(state.tagging.tags).toEqual({});
  });

  it('throws when no file handle is provided', async () => {
    const state = createDataWorkerState();
    const pipeline = createIngestionPipeline({ state });
    await expect(
      pipeline.run({} as LoadFileRequest, {} as any)
    ).rejects.toThrow('A file handle must be provided to loadFile.');
  });
});
