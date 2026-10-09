// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDataWorkerState, StaleOperationError } from './dataWorkerState';
import { createDefaultMitreAttackTacticLabels } from '@constants/mitreAttackTactics';
import type { RowBatchStore } from '../rowBatchStore';
import { TaggingStore } from '../taggingStore';
import type { LabelDefinition, TaggingSnapshot } from '../types';

const fingerprint = { fileName: 'events.csv', fileSize: 10, lastModified: 20 };
const batchStore = {} as RowBatchStore;
const label: LabelDefinition = { id: 'abc', name: 'Example', color: '#fff', createdAt: 1, updatedAt: 1 };

const createMockTaggingStore = (snapshot: TaggingSnapshot | null = null) => {
  const store = {
    load: vi.fn().mockResolvedValue(snapshot),
    save: vi.fn().mockResolvedValue(undefined)
  };
  return store as typeof store & TaggingStore;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('dataWorkerState dataset lifecycle', () => {
  it('starts a fresh loading dataset and resets to an empty one', () => {
    const state = createDataWorkerState();
    expect(state.dataset.batchStore).toBeNull();

    const dataset = state.startDataset({ batchStore, fileName: 'a.csv' });
    expect(dataset).toBe(state.dataset);
    expect(dataset).toMatchObject({ batchStore, fileName: 'a.csv', loading: true, totalRows: 0 });
    dataset.totalRows = 5;

    state.resetDataset();
    expect(state.dataset).not.toBe(dataset);
    expect(state.dataset).toMatchObject({ batchStore: null, fileName: null, totalRows: 0, loading: false });
  });

  it('ignores negative slow batch thresholds', () => {
    const state = createDataWorkerState();
    state.setOptions({ debugLogging: true, slowBatchThresholdMs: 10 });
    state.setOptions({ slowBatchThresholdMs: -1 });
    expect(state.options).toEqual({ debugLogging: true, slowBatchThresholdMs: 10 });
  });
});

describe('dataWorkerState.runViewOperation', () => {
  it('runs operations one at a time in request order', async () => {
    const state = createDataWorkerState();
    const order: string[] = [];
    let release!: () => void;
    const first = state.runViewOperation('group', async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push('first:end');
      return 1;
    });
    await Promise.resolve();
    const second = state.runViewOperation('group', async () => {
      order.push('second');
      return 2;
    });
    release();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('check() throws once a newer request for the same or an earlier stage arrives', async () => {
    const state = createDataWorkerState();
    let checkSort!: () => void;
    let release!: () => void;
    const sort = state.runViewOperation('sort', async (check) => {
      checkSort = check;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      check();
    });
    await Promise.resolve();
    expect(() => checkSort()).not.toThrow();

    const search = state.runViewOperation('search', async () => 'search');
    expect(() => checkSort()).toThrow(StaleOperationError);
    release();
    await expect(sort).rejects.toMatchObject({ name: 'StaleOperationError' });
    await expect(search).resolves.toBe('search');
  });

  it('queued operations superseded before they start never run', async () => {
    const state = createDataWorkerState();
    const stale = vi.fn();
    const first = state.runViewOperation('search', stale);
    const second = state.runViewOperation('filter', async () => 'filter');
    await expect(first).rejects.toBeInstanceOf(StaleOperationError);
    await expect(second).resolves.toBe('filter');
    expect(stale).not.toHaveBeenCalled();
  });

  it('check() throws once the dataset is replaced', async () => {
    const state = createDataWorkerState();
    state.startDataset({ batchStore, fileName: 'a.csv' });
    const operation = state.runViewOperation('group', async (check) => {
      await Promise.resolve();
      check();
    });
    state.startDataset({ batchStore, fileName: 'b.csv' });
    await expect(operation).rejects.toBeInstanceOf(StaleOperationError);
  });
});

describe('dataWorkerState tagging', () => {
  it('hydrates default MITRE ATT&CK labels when no snapshot exists yet', async () => {
    const state = createDataWorkerState();
    const store = createMockTaggingStore();
    vi.spyOn(TaggingStore, 'create').mockResolvedValue(store);

    await state.hydrateTagging(fingerprint, state.dataset);

    expect(state.tagging.store).toBe(store);
    expect(state.tagging.labels).toEqual(createDefaultMitreAttackTacticLabels());
    expect(state.tagging.tags).toEqual({});
    expect(state.tagging.dirty).toBe(false);
  });

  it('keeps a saved empty label catalog and drops invalid tags and unknown labels', async () => {
    const state = createDataWorkerState();
    vi.spyOn(TaggingStore, 'create').mockResolvedValue(createMockTaggingStore({ labels: [], tags: {} }));
    await state.hydrateTagging(fingerprint, state.dataset);
    expect(state.tagging.labels).toEqual([]);

    const snapshot = {
      labels: [label],
      tags: {
        1: { labelIds: ['abc', 'gone'], updatedAt: 5 },
        2: { labelIds: ['gone'], updatedAt: 5 },
        3: { labelIds: [], note: 'kept', updatedAt: 5 },
        '-1': { labelIds: ['abc'], updatedAt: 5 },
        '1.5': { labelIds: ['abc'], updatedAt: 5 }
      }
    } as unknown as TaggingSnapshot;
    vi.spyOn(TaggingStore, 'create').mockResolvedValue(createMockTaggingStore(snapshot));
    await state.hydrateTagging(fingerprint, state.dataset);
    expect(state.tagging.tags).toEqual({
      1: { labelIds: ['abc'], updatedAt: 5 },
      3: { labelIds: [], note: 'kept', updatedAt: 5 }
    });
  });

  it('ignores hydration results for a dataset that was replaced meanwhile', async () => {
    const state = createDataWorkerState();
    let resolveLoad!: (snapshot: TaggingSnapshot) => void;
    const store = createMockTaggingStore();
    store.load.mockReturnValue(
      new Promise<TaggingSnapshot>((resolve) => {
        resolveLoad = resolve;
      })
    );
    vi.spyOn(TaggingStore, 'create').mockResolvedValue(store);

    const first = state.startDataset({ batchStore, fileName: 'a.csv' });
    const hydration = state.hydrateTagging(fingerprint, first);
    state.startDataset({ batchStore, fileName: 'b.csv' });
    await Promise.resolve();
    resolveLoad({ labels: [label], tags: { 0: { labelIds: ['abc'], updatedAt: 1 } } });
    await hydration;

    expect(state.tagging.store).toBeNull();
    expect(state.tagging.labels).toEqual([]);
    expect(state.tagging.tags).toEqual({});
  });

  it('debounces persistence and saves the current snapshot once', async () => {
    vi.useFakeTimers();
    const state = createDataWorkerState();
    const store = createMockTaggingStore();
    state.tagging.store = store;
    state.tagging.labels = [label];
    state.tagging.tags = { 1: { labelIds: ['abc'], updatedAt: 1 } };

    state.markTaggingDirty();
    state.markTaggingDirty();
    expect(state.tagging.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(299);
    expect(store.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith({ labels: [label], tags: { 1: { labelIds: ['abc'], updatedAt: 1 } } });
    expect(state.tagging.dirty).toBe(false);
    expect(state.tagging.persistTimer).toBeNull();
  });

  it('keeps a failed save dirty and retries it', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const state = createDataWorkerState();
    const store = createMockTaggingStore();
    store.save.mockRejectedValueOnce(new Error('quota'));
    state.tagging.store = store;

    state.markTaggingDirty();
    await vi.advanceTimersByTimeAsync(300);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(state.tagging.dirty).toBe(true);
    expect(state.tagging.persistTimer).not.toBeNull();

    // Failures back off instead of retrying at the edit debounce.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(store.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(state.tagging.dirty).toBe(false);
  });

  it('persistTaggingNow saves immediately, and only when dirty', async () => {
    vi.useFakeTimers();
    const state = createDataWorkerState();
    const store = createMockTaggingStore();
    state.tagging.store = store;

    await state.persistTaggingNow();
    expect(store.save).not.toHaveBeenCalled();

    state.markTaggingDirty();
    await state.persistTaggingNow();
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(state.tagging.persistTimer).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('runs saves one at a time so an older snapshot never lands last', async () => {
    const state = createDataWorkerState();
    const store = createMockTaggingStore();
    const order: string[] = [];
    let releaseFirst!: () => void;
    store.save
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            order.push('first:start');
            releaseFirst = () => {
              order.push('first:end');
              resolve();
            };
          })
      )
      .mockImplementationOnce(async () => {
        order.push('second:start');
      });
    state.tagging.store = store;

    state.markTaggingDirty();
    const first = state.persistTaggingNow();
    await vi.waitFor(() => expect(order).toEqual(['first:start']));
    state.markTaggingDirty(); // edited while the first save is still writing
    const second = state.persistTaggingNow();
    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('resetTagging cancels a pending save', async () => {
    vi.useFakeTimers();
    const state = createDataWorkerState();
    const store = createMockTaggingStore();
    state.tagging.store = store;
    state.markTaggingDirty();
    state.resetTagging();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.save).not.toHaveBeenCalled();
    expect(state.tagging).toMatchObject({ store: null, dirty: false, labels: [], tags: {} });
  });
});
