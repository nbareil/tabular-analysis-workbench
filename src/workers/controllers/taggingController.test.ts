import { describe, expect, it } from 'vitest';

import { createTaggingController } from './taggingController';
import { createDataWorkerState } from '../state/dataWorkerState';

describe('taggingController', () => {
  it('updates tagging snapshot when tagging rows', async () => {
    const state = createDataWorkerState();
    state.updateTagging((tagging) => {
      tagging.labels = [
        {
          id: 'alpha',
          name: 'Alpha',
          color: '#fff',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
    });

    const controller = createTaggingController(state);
    const response = await controller.tagRows({
      rowIds: [1, 2],
      labelIds: ['alpha'],
      note: 'test'
    });

    expect(Object.keys(response.updated)).toHaveLength(2);
    expect(state.tagging.tags[1]).toMatchObject({
      labelIds: ['alpha'],
      note: 'test'
    });
    expect(state.tagging.dirty).toBe(true);
  });

  it('clears tagging metadata when clear() is called', () => {
    const state = createDataWorkerState();
    state.updateTagging((tagging) => {
      tagging.labels = [
        {
          id: 'alpha',
          name: 'Alpha',
          color: '#fff',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      tagging.tags = {
        1: {
          labelIds: ['alpha'],
          updatedAt: Date.now()
        }
      };
    });

    const controller = createTaggingController(state);
    controller.clear();

    expect(state.tagging.labels).toHaveLength(0);
    expect(state.tagging.tags).toEqual({});
  });

  it('returns no updates when deleting an unknown label', async () => {
    const state = createDataWorkerState();
    state.updateTagging((tagging) => {
      tagging.labels = [
        {
          id: 'alpha',
          name: 'Alpha',
          color: '#fff',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
    });

    const controller = createTaggingController(state);
    const result = await controller.deleteLabel({ labelId: 'beta' });

    expect(result.deleted).toBe(false);
    expect(result.updated).toEqual({});
  });
});
