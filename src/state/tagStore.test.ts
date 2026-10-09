import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { shallow } from 'zustand/shallow';

import type { DeleteLabelResponse, TagRowsResponse, TaggingSnapshot } from '@workers/types';

const worker = {
  tagRows: vi.fn(),
  clearTag: vi.fn(),
  restoreTags: vi.fn(),
  deleteLabel: vi.fn(),
  updateLabel: vi.fn(),
  loadTags: vi.fn(),
  importTags: vi.fn(),
  exportTags: vi.fn()
};

vi.mock('@workers/dataWorkerProxy', async () => {
  const actual = await vi.importActual<typeof import('@workers/dataWorkerProxy')>('@workers/dataWorkerProxy');
  return { ...actual, getDataWorker: () => worker };
});

import { useTagStore } from './tagStore';
import { useDataStore } from './dataStore';
import { useUndoStore } from './undoStore';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('useTagStore', () => {
  beforeEach(() => {
    Object.values(worker).forEach((fn) => fn.mockReset());
    useTagStore.getState().reset();
    useUndoStore.getState().clear();
  });

  it('load mirrors the worker snapshot', async () => {
    const snapshot: TaggingSnapshot = {
      labels: [{ id: 'l1', name: 'A', color: '#f00', createdAt: 1, updatedAt: 1 }],
      tags: { 3: { labelIds: ['l1'], updatedAt: 1 } }
    };
    worker.loadTags.mockResolvedValue(snapshot);

    await useTagStore.getState().load();

    expect(useTagStore.getState()).toMatchObject({ ...snapshot, status: 'ready', error: null });
  });

  it('records worker errors in the store', async () => {
    worker.loadTags.mockRejectedValue(new Error('no worker'));
    await useTagStore.getState().load();
    expect(useTagStore.getState()).toMatchObject({ status: 'error', error: 'no worker' });
  });

  it('removes tag entries when the worker returns tombstone updates', async () => {
    const response: TagRowsResponse = { updated: { 42: { labelIds: [], updatedAt: 20 } } };
    worker.tagRows.mockResolvedValue(response);
    useTagStore.setState({ tags: { 42: { labelIds: ['existing'], updatedAt: 10 } }, status: 'ready' });

    await useTagStore.getState().applyTag({ rowIds: [42], labelIds: null });

    expect(useTagStore.getState().tags[42]).toBeUndefined();
  });

  it('records an undo entry with the rows previous and new records', async () => {
    useTagStore.setState({ tags: { 1: { labelIds: ['old'], updatedAt: 1 } } });
    worker.tagRows.mockResolvedValue({
      updated: { 1: { labelIds: ['new'], updatedAt: 2 }, 2: { labelIds: ['new'], updatedAt: 2 } }
    });

    await useTagStore.getState().applyTag({ rowIds: [1, 2], labelIds: ['new'] });

    expect(useUndoStore.getState().past).toEqual([
      {
        kind: 'tags',
        before: { 1: { labelIds: ['old'], updatedAt: 1 }, 2: null },
        after: { 1: { labelIds: ['new'], updatedAt: 2 }, 2: { labelIds: ['new'], updatedAt: 2 } }
      }
    ]);
  });

  it('records cleared rows as null in the undo entry', async () => {
    useTagStore.setState({ tags: { 5: { labelIds: ['x'], updatedAt: 1 } } });
    worker.clearTag.mockResolvedValue({ updated: { 5: { labelIds: [], updatedAt: 2 } } });

    await useTagStore.getState().clearTag([5]);

    expect(useTagStore.getState().tags[5]).toBeUndefined();
    expect(useUndoStore.getState().past.at(-1)).toEqual({
      kind: 'tags',
      before: { 5: { labelIds: ['x'], updatedAt: 1 } },
      after: { 5: null }
    });
  });

  it('does not record an undo entry when the worker call fails', async () => {
    worker.tagRows.mockRejectedValue(new Error('fail'));
    const result = await useTagStore.getState().applyTag({ rowIds: [1], labelIds: ['a'] });
    expect(result).toBeNull();
    expect(useUndoStore.getState().past).toEqual([]);
  });

  it('restoreTags applies records without recording undo', async () => {
    worker.restoreTags.mockResolvedValue({ updated: { 9: { labelIds: ['a'], updatedAt: 3 } } });
    await useTagStore.getState().restoreTags({ 9: { labelIds: ['a'], updatedAt: 3 } });
    expect(useTagStore.getState().tags[9]).toEqual({ labelIds: ['a'], updatedAt: 3 });
    expect(useUndoStore.getState().past).toEqual([]);
  });

  it('updates labels and preserves note-only records on delete', async () => {
    const response: DeleteLabelResponse = {
      deleted: true,
      updated: { 7: { labelIds: [], note: 'persisted note', updatedAt: 50 } }
    };
    worker.deleteLabel.mockResolvedValue(response);
    useTagStore.setState({
      labels: [{ id: 'label-1', name: 'Alpha', color: '#ff0', createdAt: 1, updatedAt: 1 }],
      tags: { 7: { labelIds: ['label-1'], note: 'persisted note', updatedAt: 10 } },
      status: 'ready'
    });

    expect(await useTagStore.getState().deleteLabel('label-1')).toBe(true);
    expect(useTagStore.getState().labels).toHaveLength(0);
    expect(useTagStore.getState().tags[7]).toEqual({ labelIds: [], note: 'persisted note', updatedAt: 50 });
  });

  it('upsertLabel replaces an existing label or appends a new one', async () => {
    useTagStore.setState({ labels: [{ id: 'a', name: 'A', color: '#000', createdAt: 1, updatedAt: 1 }] });
    worker.updateLabel.mockImplementation(async ({ label }) => label);

    await useTagStore.getState().upsertLabel({ id: 'a', name: 'Renamed' });
    await useTagStore.getState().upsertLabel({ name: 'Fresh' });

    const labels = useTagStore.getState().labels;
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatchObject({ id: 'a', name: 'Renamed' });
    expect(labels[1]).toMatchObject({ name: 'Fresh', color: '#8899ff' });
  });

  it('drops worker responses when another file was opened mid-request', async () => {
    const request = deferred<TagRowsResponse>();
    worker.tagRows.mockReturnValue(request.promise);

    const pending = useTagStore.getState().applyTag({ rowIds: [1], labelIds: ['a'] });
    useDataStore.getState().startLoading('other.csv');
    request.resolve({ updated: { 1: { labelIds: ['a'], updatedAt: 1 } } });
    await pending;

    expect(useTagStore.getState().tags).toEqual({});
  });

  it('does not record undo history for a response dropped after a file change', async () => {
    const request = deferred<TagRowsResponse>();
    worker.tagRows.mockReturnValue(request.promise);

    const pending = useTagStore.getState().applyTag({ rowIds: [1], labelIds: ['a'] });
    useDataStore.getState().startLoading('other.csv');
    useUndoStore.getState().clear();
    request.resolve({ updated: { 1: { labelIds: ['a'], updatedAt: 1 } } });
    await pending;

    expect(useUndoStore.getState().past).toEqual([]);
  });

  it('importTags applies the response for the current file', async () => {
    const snapshot: TaggingSnapshot = { labels: [], tags: { 1: { labelIds: ['x'], updatedAt: 1 } } };
    worker.importTags.mockResolvedValue(snapshot);

    await expect(useTagStore.getState().importTags(snapshot, 'merge')).resolves.toEqual(snapshot);
    expect(useTagStore.getState().tags).toEqual(snapshot.tags);
    expect(worker.importTags).toHaveBeenCalledWith(expect.objectContaining({ mergeStrategy: 'merge' }));
  });

  it('importTags ignores the response if the file changed mid-request', async () => {
    const request = deferred<TaggingSnapshot>();
    worker.importTags.mockReturnValue(request.promise);

    const pending = useTagStore.getState().importTags({ labels: [], tags: {} }, 'replace');
    useDataStore.getState().startLoading('other.csv');
    request.resolve({ labels: [], tags: { 1: { labelIds: ['x'], updatedAt: 1 } } });
    await pending;

    expect(useTagStore.getState().tags).toEqual({});
  });

  it('importTags rejects with the worker error', async () => {
    worker.importTags.mockRejectedValue(new Error('export belongs to another file'));
    await expect(useTagStore.getState().importTags({ labels: [], tags: {} }, 'replace')).rejects.toThrow(
      'export belongs to another file'
    );
  });

  it('does not trigger selector updates for unrelated store changes', () => {
    let renders = 0;
    const { unmount } = renderHook(() => {
      renders += 1;
      return useTagStore((state) => ({ labels: state.labels, status: state.status }), shallow);
    });

    act(() => {
      useTagStore.setState({ error: 'boom' });
    });

    expect(renders).toBe(1);
    unmount();
  });
});
