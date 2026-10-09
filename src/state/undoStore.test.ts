import { beforeEach, describe, expect, it } from 'vitest';

import { useUndoStore, type UndoEntry } from './undoStore';

const filterEntry = (n: number): UndoEntry => ({
  kind: 'filters',
  before: [],
  after: [{ id: `f${n}`, column: 'c', operator: 'eq', value: n }]
});

describe('undoStore', () => {
  beforeEach(() => {
    useUndoStore.getState().clear();
  });

  it('returns null when there is nothing to undo or redo', () => {
    expect(useUndoStore.getState().takeUndo()).toBeNull();
    expect(useUndoStore.getState().takeRedo()).toBeNull();
  });

  it('undoes the latest entry first and redoes it back', () => {
    const { record } = useUndoStore.getState();
    record(filterEntry(1));
    record(filterEntry(2));

    expect(useUndoStore.getState().takeUndo()).toEqual(filterEntry(2));
    expect(useUndoStore.getState().takeUndo()).toEqual(filterEntry(1));
    expect(useUndoStore.getState().takeUndo()).toBeNull();

    expect(useUndoStore.getState().takeRedo()).toEqual(filterEntry(1));
    expect(useUndoStore.getState().takeRedo()).toEqual(filterEntry(2));
    expect(useUndoStore.getState().takeRedo()).toBeNull();
    expect(useUndoStore.getState().past).toHaveLength(2);
  });

  it('drops the redo history when a new edit is recorded', () => {
    const { record } = useUndoStore.getState();
    record(filterEntry(1));
    useUndoStore.getState().takeUndo();
    expect(useUndoStore.getState().future).toHaveLength(1);

    record(filterEntry(3));

    expect(useUndoStore.getState().future).toEqual([]);
    expect(useUndoStore.getState().takeRedo()).toBeNull();
  });

  it('keeps at most 100 entries, discarding the oldest', () => {
    for (let i = 0; i < 105; i += 1) {
      useUndoStore.getState().record(filterEntry(i));
    }
    const { past } = useUndoStore.getState();
    expect(past).toHaveLength(100);
    expect(past[0]).toEqual(filterEntry(5));
    expect(past.at(-1)).toEqual(filterEntry(104));
  });

  it('clear empties both stacks', () => {
    useUndoStore.getState().record(filterEntry(1));
    useUndoStore.getState().record(filterEntry(2));
    useUndoStore.getState().takeUndo();
    useUndoStore.getState().clear();
    expect(useUndoStore.getState().past).toEqual([]);
    expect(useUndoStore.getState().future).toEqual([]);
  });
});

describe('undoStore merging', () => {
  it('merges edits with the same merge key into one step, keeping the oldest before', () => {
    useUndoStore.getState().clear();
    const filter = (value: string) => [{ id: 'f', column: 'c', operator: 'contains', value }];
    useUndoStore.getState().record({ kind: 'filters', before: filter(''), after: filter('a') }, 'k');
    useUndoStore.getState().record({ kind: 'filters', before: filter('a'), after: filter('ab') }, 'k');

    expect(useUndoStore.getState().past).toEqual([{ kind: 'filters', before: filter(''), after: filter('ab') }]);
  });
});
