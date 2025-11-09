import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeleteLabelResponse, TagRowsResponse } from '@workers/types';
import { getDataWorker } from '@workers/dataWorkerProxy';
import { useTagStore } from './tagStore';

vi.mock('@workers/dataWorkerProxy', () => ({
  getDataWorker: vi.fn()
}));

const mockedGetDataWorker = vi.mocked(getDataWorker);

describe('useTagStore', () => {
  beforeEach(() => {
    useTagStore.setState({
      labels: [],
      tags: {},
      status: 'idle',
      error: null
    });
    mockedGetDataWorker.mockReset();
  });

  it('removes tag entries when worker returns tombstone updates', async () => {
    const response: TagRowsResponse = {
      updated: {
        42: {
          labelId: null,
          updatedAt: 20
        }
      }
    };
    mockedGetDataWorker.mockReturnValue({
      tagRows: vi.fn().mockResolvedValue(response)
    } as unknown as ReturnType<typeof getDataWorker>);

    useTagStore.setState({
      tags: {
        42: {
          labelId: 'existing',
          color: '#000',
          updatedAt: 10
        }
      },
      status: 'ready'
    });

    await useTagStore.getState().applyTag({ rowIds: [42], labelId: null });

    expect(useTagStore.getState().tags[42]).toBeUndefined();
  });

  it('updates labels and preserves note tombstones on delete', async () => {
    const response: DeleteLabelResponse = {
      deleted: true,
      updated: {
        7: {
          labelId: null,
          note: 'persisted note',
          updatedAt: 50
        }
      }
    };

    mockedGetDataWorker.mockReturnValue({
      deleteLabel: vi.fn().mockResolvedValue(response)
    } as unknown as ReturnType<typeof getDataWorker>);

    useTagStore.setState({
      labels: [
        {
          id: 'label-1',
          name: 'Alpha',
          color: '#ff0',
          createdAt: 1,
          updatedAt: 1
        }
      ],
      tags: {
        7: {
          labelId: 'label-1',
          note: 'persisted note',
          updatedAt: 10
        }
      },
      status: 'ready'
    });

    const deleted = await useTagStore.getState().deleteLabel('label-1');
    expect(deleted).toBe(true);
    expect(useTagStore.getState().labels).toHaveLength(0);
    expect(useTagStore.getState().tags[7]).toEqual({
      labelId: null,
      note: 'persisted note',
      updatedAt: 50
    });
  });
});
