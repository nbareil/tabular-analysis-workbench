import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFilterSync } from './useFilterSync';
import { useSessionStore, type FilterState } from '@state/sessionStore';
import { useDataStore } from '@state/dataStore';
import { useUndoStore } from '@state/undoStore';

const mockApplyFilter = vi.fn();

vi.mock('@workers/dataWorkerProxy', async () => {
  const actual = await vi.importActual<typeof import('@workers/dataWorkerProxy')>('@workers/dataWorkerProxy');
  return { ...actual, getDataWorker: () => ({ applyFilter: mockApplyFilter }) };
});

const filter: FilterState = { id: 'f1', column: 'message', operator: 'eq', value: 'login success', enabled: true };

const staleError = (): Error => Object.assign(new Error('superseded'), { name: 'StaleOperationError' });

describe('useFilterSync', () => {
  beforeEach(() => {
    mockApplyFilter.mockReset();
    mockApplyFilter.mockResolvedValue({ matchedRows: 75, totalRows: 100, predicateMatchCounts: { f1: 75 } });
    useSessionStore.getState().openFiles([]);
    useDataStore.getState().reset();
    useDataStore.setState({ status: 'ready', totalRows: 100, matchedRows: 100 });
    useUndoStore.getState().clear();
  });

  it('stores the filters, sends the expression and records the summary', async () => {
    const { result } = renderHook(() => useFilterSync());
    const viewVersion = useDataStore.getState().viewVersion;

    await act(() => result.current.applyFilters([filter]));

    expect(result.current.filters).toEqual([filter]);
    expect(mockApplyFilter).toHaveBeenCalledWith({ expression: expect.objectContaining({ op: 'and' }) });
    expect(useDataStore.getState()).toMatchObject({
      matchedRows: 75,
      filterActive: true,
      filterPredicateMatchCounts: { f1: 75 }
    });
    expect(useDataStore.getState().viewVersion).toBe(viewVersion + 1);
  });

  it('clears the filter summary when no filter is complete', async () => {
    mockApplyFilter.mockResolvedValue({ matchedRows: 100, totalRows: 100 });
    useDataStore.getState().setFilterSummary({ matchedRows: 3, totalRows: 100 });
    const { result } = renderHook(() => useFilterSync());

    await act(() => result.current.applyFilters([]));

    expect(mockApplyFilter).toHaveBeenCalledWith({ expression: null });
    expect(useDataStore.getState()).toMatchObject({ matchedRows: 100, filterActive: false });
  });

  it('records an undo entry with the previous and next filters', async () => {
    const { result } = renderHook(() => useFilterSync());

    await act(() => result.current.applyFilters([filter]));
    const second = { ...filter, id: 'f2', value: 'other' };
    await act(() => result.current.applyFilters([filter, second]));

    expect(useUndoStore.getState().past).toEqual([
      { kind: 'filters', before: [], after: [filter] },
      { kind: 'filters', before: [filter], after: [filter, second] }
    ]);
  });

  it('does not record undo entries when undoable is false', async () => {
    const { result } = renderHook(() => useFilterSync());

    await act(() => result.current.applyFilters([filter], { undoable: false }));

    expect(useUndoStore.getState().past).toEqual([]);
    expect(useSessionStore.getState().filters).toEqual([filter]);
  });

  it('ignores stale-operation rejections', async () => {
    mockApplyFilter.mockRejectedValue(staleError());
    const { result } = renderHook(() => useFilterSync());

    await act(() => result.current.applyFilters([filter]));

    expect(useDataStore.getState().errorDetails).toBeNull();
    expect(useDataStore.getState().filterActive).toBe(false);
  });

  it('reports other errors without changing the load status, with a retry that is not undoable', async () => {
    mockApplyFilter.mockRejectedValueOnce(new Error('bad regex'));
    const { result } = renderHook(() => useFilterSync());

    await act(() => result.current.applyFilters([filter]));

    const state = useDataStore.getState();
    expect(state.status).toBe('ready');
    expect(state.errorDetails?.message).toBe('Failed to apply filter');
    const payload = state.errorDetails?.payload as { operation: string; retry: () => Promise<void> };
    expect(payload.operation).toBe('filters.apply');

    await act(() => payload.retry());
    expect(mockApplyFilter).toHaveBeenCalledTimes(2);
    expect(useUndoStore.getState().past).toHaveLength(1);
    expect(useDataStore.getState().matchedRows).toBe(75);
  });
});
