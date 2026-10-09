import { beforeEach, describe, expect, it } from 'vitest';

import { describeFiles, getSessionSnapshot, useSessionStore } from './sessionStore';
import type { ColumnInference } from '@workers/types';

const handle = (name: string): FileSystemFileHandle => ({ name, kind: 'file' }) as unknown as FileSystemFileHandle;

const inference = (nullCount: number): ColumnInference => ({
  type: 'string',
  confidence: 1,
  samples: 10,
  nullCount,
  examples: []
});

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().openFiles([]);
  });

  it('openFiles stores the handles and resets all view state', () => {
    const store = useSessionStore.getState();
    store.setFilters([{ id: 'f', column: 'a', operator: 'eq', value: 'x' }]);
    store.setSorts([{ column: 'a', direction: 'asc' }]);
    store.setGroups(['a']);
    store.setGroupAggregations([{ operator: 'sum', column: 'b', alias: 'total' }]);
    store.setColumnLayout({ order: ['a'], visibility: { a: false } });

    const handles = [handle('one.csv')];
    useSessionStore.getState().openFiles(handles);

    const state = useSessionStore.getState();
    expect(state.fileHandles).toBe(handles);
    expect(state.filters).toEqual([]);
    expect(state.sorts).toEqual([]);
    expect(state.groups).toEqual([]);
    expect(state.groupAggregations).toEqual([{ operator: 'count', alias: 'count' }]);
    expect(state.columnLayout).toEqual({ order: [], visibility: {} });
  });

  it('initializeColumnLayout hides columns that are entirely empty', () => {
    useSessionStore
      .getState()
      .initializeColumnLayout(['full', 'empty', 'unknown'], { full: inference(2), empty: inference(10) }, 10);

    expect(useSessionStore.getState().columnLayout).toEqual({
      order: ['full', 'empty', 'unknown'],
      visibility: { full: true, empty: false, unknown: true }
    });
  });

  it('getSessionSnapshot exposes file names instead of handles and no actions', () => {
    useSessionStore.getState().openFiles([handle('a.csv'), handle('b.csv')]);
    useSessionStore.getState().setSorts([{ column: 'ts', direction: 'desc' }]);

    expect(getSessionSnapshot()).toStrictEqual({
      fileNames: ['a.csv', 'b.csv'],
      filters: [],
      sorts: [{ column: 'ts', direction: 'desc' }],
      groups: [],
      groupAggregations: [{ operator: 'count', alias: 'count' }],
      columnLayout: { order: [], visibility: {} }
    });
  });

  it('describeFiles names single and merged datasets', () => {
    expect(describeFiles([])).toBe('');
    expect(describeFiles([handle('a.csv')])).toBe('a.csv');
    expect(describeFiles([handle('a.csv'), handle('b.csv'), handle('c.csv')])).toBe('a.csv + 2 more');
  });
});
