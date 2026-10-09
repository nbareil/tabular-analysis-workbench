import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';

import { useSortSync } from './useSortSync';

const mockApplySorts = vi.fn();

vi.mock('@workers/dataWorkerProxy', async () => {
  const actual = await vi.importActual<typeof import('@workers/dataWorkerProxy')>('@workers/dataWorkerProxy');
  return { ...actual, getDataWorker: () => ({ applySorts: mockApplySorts }) };
});

describe('useSortSync', () => {
  beforeEach(() => {
    mockApplySorts.mockReset();
    useSessionStore.getState().openFiles([]);
    useDataStore.getState().reset();
    useDataStore.setState({ status: 'ready', totalRows: 100, matchedRows: 100 });
  });

  it('applies sorts and adopts the sorts the worker reports', async () => {
    mockApplySorts.mockResolvedValue({ matchedRows: 40, sorts: [{ column: 'ts', direction: 'desc' }] });
    const { result } = renderHook(() => useSortSync());
    const viewVersion = useDataStore.getState().viewVersion;

    await act(() =>
      result.current.applySorts([
        { column: 'ts', direction: 'desc' },
        { column: 'missing', direction: 'asc' }
      ])
    );

    expect(mockApplySorts).toHaveBeenCalledWith({
      sorts: [
        { column: 'ts', direction: 'desc' },
        { column: 'missing', direction: 'asc' }
      ]
    });
    expect(result.current.sorts).toEqual([{ column: 'ts', direction: 'desc' }]);
    expect(useDataStore.getState().matchedRows).toBe(40);
    expect(useDataStore.getState().viewVersion).toBe(viewVersion + 1);
  });

  it('ignores stale-operation rejections', async () => {
    mockApplySorts.mockRejectedValue(Object.assign(new Error('stale'), { name: 'StaleOperationError' }));
    const { result } = renderHook(() => useSortSync());

    await act(() => result.current.applySorts([{ column: 'ts', direction: 'asc' }]));

    expect(useDataStore.getState().errorDetails).toBeNull();
  });

  it('reports other errors without changing the load status', async () => {
    mockApplySorts.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSortSync());

    await act(() => result.current.applySorts([{ column: 'ts', direction: 'asc' }]));

    const state = useDataStore.getState();
    expect(state.status).toBe('ready');
    expect(state.errorDetails?.message).toBe('Failed to apply sorts');
    expect(state.errorDetails?.payload).toMatchObject({ operation: 'sorts.apply', retry: expect.any(Function) });
  });
});
