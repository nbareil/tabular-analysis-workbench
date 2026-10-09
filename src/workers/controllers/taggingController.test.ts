// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createTaggingController } from './taggingController';
import { createDataWorkerState } from '../state/dataWorkerState';
import type { LabelDefinition } from '../types';
import { TAG_EXPORT_VERSION } from '../types';

const makeLabel = (id: string): LabelDefinition => ({ id, name: id.toUpperCase(), color: '#fff', createdAt: 1, updatedAt: 1 });

const setup = (totalRows = 10) => {
  const state = createDataWorkerState();
  state.tagging.labels = [makeLabel('alpha'), makeLabel('beta')];
  state.dataset.totalRows = totalRows;
  state.dataset.fileName = 'events.csv';
  return { state, controller: createTaggingController(state) };
};

describe('taggingController.tagRows', () => {
  it('replaces labels by default, sets notes and marks tagging dirty', async () => {
    const { state, controller } = setup();
    const response = await controller.tagRows({ rowIds: [1, 2], labelIds: ['alpha', 'unknown'], note: 'test' });
    expect(Object.keys(response.updated)).toEqual(['1', '2']);
    expect(state.tagging.tags[1]).toMatchObject({ labelIds: ['alpha'], note: 'test' });
    expect(state.tagging.dirty).toBe(true);

    await controller.tagRows({ rowIds: [1], labelIds: ['beta'] });
    expect(state.tagging.tags[1]).toMatchObject({ labelIds: ['beta'], note: 'test' });
  });

  it('appends and removes labels', async () => {
    const { state, controller } = setup();
    await controller.tagRows({ rowIds: [0], labelIds: ['alpha'] });
    await controller.tagRows({ rowIds: [0], labelIds: ['beta', 'alpha'], mode: 'append' });
    expect(state.tagging.tags[0]!.labelIds).toEqual(['alpha', 'beta']);
    await controller.tagRows({ rowIds: [0], labelIds: ['alpha'], mode: 'remove' });
    expect(state.tagging.tags[0]!.labelIds).toEqual(['beta']);
  });

  it('deletes records that become empty and skips invalid row ids', async () => {
    const { state, controller } = setup();
    await controller.tagRows({ rowIds: [0, -1, Number.NaN], labelIds: ['alpha'] });
    expect(Object.keys(state.tagging.tags)).toEqual(['0']);
    await controller.tagRows({ rowIds: [0], labelIds: null });
    expect(state.tagging.tags).toEqual({});
  });

  it('does not mark tagging dirty when nothing changed', async () => {
    const { state, controller } = setup();
    await controller.tagRows({ rowIds: [3], labelIds: [] });
    expect(state.tagging.dirty).toBe(false);
  });
});

describe('taggingController other mutations', () => {
  it('clearTag removes records', async () => {
    const { state, controller } = setup();
    await controller.tagRows({ rowIds: [1, 2], labelIds: ['alpha'] });
    const response = await controller.clearTag([1]);
    expect(response.updated[1]!.labelIds).toEqual([]);
    expect(Object.keys(state.tagging.tags)).toEqual(['2']);
  });

  it('restoreTags sets records verbatim and removes null ones', async () => {
    const { state, controller } = setup();
    await controller.tagRows({ rowIds: [1], labelIds: ['alpha'] });
    const record = { labelIds: ['beta'], note: 'back', updatedAt: 42 };
    const response = await controller.restoreTags({ 1: null, 4: record });
    expect(state.tagging.tags).toEqual({ 4: record });
    expect(state.tagging.tags[4]).not.toBe(record);
    expect(response.updated[1]!.labelIds).toEqual([]);
    expect(response.updated[4]).toEqual(record);
    expect(state.tagging.dirty).toBe(true);
  });

  it('updateLabel inserts or replaces with sanitised fields', async () => {
    const { state, controller } = setup();
    const created = await controller.updateLabel({ label: { ...makeLabel('gamma'), name: '  ', color: '' } });
    expect(created).toMatchObject({ id: 'gamma', name: 'Untitled label', color: '#8899ff' });
    await controller.updateLabel({ label: { ...makeLabel('alpha'), name: ' Renamed ' } });
    expect(state.tagging.labels.map((label) => label.name)).toEqual(['Renamed', 'BETA', 'Untitled label']);
  });

  it('deleteLabel cascades to records and keeps notes', async () => {
    const { state, controller } = setup();
    await controller.tagRows({ rowIds: [1], labelIds: ['alpha'], note: 'keep' });
    await controller.tagRows({ rowIds: [2], labelIds: ['alpha'] });
    const result = await controller.deleteLabel({ labelId: 'alpha' });
    expect(result.deleted).toBe(true);
    expect(Object.keys(result.updated)).toEqual(['1', '2']);
    expect(state.tagging.tags).toEqual({ 1: expect.objectContaining({ labelIds: [], note: 'keep' }) });
    expect(state.tagging.labels.map((label) => label.id)).toEqual(['beta']);
  });

  it('deleteLabel reports nothing for an unknown label', async () => {
    const { controller } = setup();
    expect(await controller.deleteLabel({ labelId: 'zzz' })).toEqual({ deleted: false, updated: {} });
  });
});

describe('taggingController export/import', () => {
  it('exports labels, tags and the source row count', async () => {
    const { controller } = setup(7);
    await controller.tagRows({ rowIds: [1], labelIds: ['alpha'] });
    const exported = await controller.exportTags();
    expect(exported.version).toBe(TAG_EXPORT_VERSION);
    expect(exported.source).toEqual({ fileName: 'events.csv', rowCount: 7 });
    expect(Object.keys(exported.payload.tags)).toEqual(['1']);
  });

  it('merges imports by appending labels to existing records', async () => {
    const { state, controller } = setup();
    await controller.tagRows({ rowIds: [1], labelIds: ['alpha'], note: 'mine' });
    const snapshot = await controller.importTags({
      labels: [makeLabel('gamma')],
      tags: { 1: { labelIds: ['gamma', 'missing'], updatedAt: 5 }, 2: { labelIds: ['beta'], updatedAt: 5 } },
      source: { rowCount: 10 }
    });
    expect(snapshot.labels.map((label) => label.id)).toEqual(['alpha', 'beta', 'gamma']);
    expect(state.tagging.tags[1]).toMatchObject({ labelIds: ['alpha', 'gamma'], note: 'mine' });
    expect(state.tagging.tags[2]!.labelIds).toEqual(['beta']);
    expect(state.tagging.dirty).toBe(true);
  });

  it('replaces everything with the replace strategy', async () => {
    const { state, controller } = setup();
    await controller.tagRows({ rowIds: [1], labelIds: ['alpha'] });
    await controller.importTags({
      labels: [makeLabel('gamma')],
      tags: { 2: { labelIds: ['gamma'], updatedAt: 5 } },
      mergeStrategy: 'replace'
    });
    expect(state.tagging.labels.map((label) => label.id)).toEqual(['gamma']);
    expect(Object.keys(state.tagging.tags)).toEqual(['2']);
  });

  it('rejects an import whose source row count differs from the open file', async () => {
    const { state, controller } = setup(10);
    await expect(
      controller.importTags({ labels: [], tags: { 1: { labelIds: ['alpha'], updatedAt: 1 } }, source: { rowCount: 11 } })
    ).rejects.toThrow(/11 rows/);
    expect(state.tagging.tags).toEqual({});
    expect(state.tagging.dirty).toBe(false);
  });

  it('ignores out-of-range and non-integer row ids', async () => {
    const { state, controller } = setup(3);
    await controller.importTags({
      labels: [],
      tags: {
        0: { labelIds: ['alpha'], updatedAt: 1 },
        3: { labelIds: ['alpha'], updatedAt: 1 },
        '-1': { labelIds: ['alpha'], updatedAt: 1 },
        '1.5': { labelIds: ['alpha'], updatedAt: 1 }
      } as never
    });
    expect(Object.keys(state.tagging.tags)).toEqual(['0']);
  });
});
