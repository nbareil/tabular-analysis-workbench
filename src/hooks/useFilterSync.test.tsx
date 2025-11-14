import { render, act, cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { useFilterSync } from './useFilterSync';
import { useSessionStore } from '@state/sessionStore';
import { useDataStore } from '@state/dataStore';
import type { FilterState } from '@state/sessionStore';

const mockApplyFilter = vi.fn();

vi.mock('@workers/dataWorkerProxy', () => {
  return {
    getDataWorker: () => ({
      applyFilter: mockApplyFilter
    })
  };
});

const TestHarness = (): null => {
  useFilterSync();
  return null;
};

const baseFilter: FilterState = {
  id: 'boot',
  column: 'message',
  operator: 'eq',
  value: 'login success',
  enabled: true
};

const resetStores = () => {
  useSessionStore.setState((state) => ({
    ...state,
    filters: [],
    updatedAt: Date.now()
  }));
  useDataStore.setState((state) => ({
    ...state,
    status: 'idle',
    totalRows: 0,
    matchedRows: null,
    filterMatchedRows: null
  }));
};

describe('useFilterSync', () => {
  beforeEach(() => {
    mockApplyFilter.mockReset();
    mockApplyFilter.mockResolvedValue({
      matchedRows: 75,
      totalRows: 100,
      predicateMatchCounts: null,
      fuzzyUsed: null
    });
    resetStores();
  });

  afterEach(() => {
    cleanup();
  });

  it('auto-applies persisted filters once data is ready', async () => {
    await act(async () => {
      useSessionStore.setState((state) => ({
        ...state,
        filters: [baseFilter]
      }));
      useDataStore.setState((state) => ({
        ...state,
        status: 'ready',
        totalRows: 100
      }));
    });

    render(<TestHarness />);

    await waitFor(() => expect(mockApplyFilter).toHaveBeenCalledTimes(1));
    expect(mockApplyFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        expression: expect.objectContaining({ op: 'and' }),
        offset: 0,
        limit: 0
      })
    );
  });

  it('defers bootstrap until the worker reports ready rows', async () => {
    await act(async () => {
      useSessionStore.setState((state) => ({
        ...state,
        filters: [baseFilter]
      }));
      useDataStore.setState((state) => ({
        ...state,
        status: 'loading',
        totalRows: 0
      }));
    });

    render(<TestHarness />);
    expect(mockApplyFilter).not.toHaveBeenCalled();

    await act(async () => {
      useDataStore.setState((state) => ({
        ...state,
        status: 'ready',
        totalRows: 42
      }));
    });

    await waitFor(() => expect(mockApplyFilter).toHaveBeenCalledTimes(1));
  });
});
