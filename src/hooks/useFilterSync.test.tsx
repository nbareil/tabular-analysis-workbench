import { render, act, cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { useEffect } from 'react';

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

const ControlHarness = ({ onReady }: { onReady: (applyFilters: (filters: FilterState[]) => Promise<void>) => void }): null => {
  const { applyFilters } = useFilterSync();
  useEffect(() => {
    onReady(applyFilters);
  }, [applyFilters, onReady]);
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

  it('ignores stale worker responses that resolve out of order', async () => {
    await act(async () => {
      useDataStore.setState((state) => ({
        ...state,
        status: 'idle',
        totalRows: 0,
        matchedRows: null
      }));
      useSessionStore.setState((state) => ({
        ...state,
        filters: []
      }));
    });

    const createDeferredResponse = () => {
      let resolver: ((value: unknown) => void) | undefined;
      const promise = new Promise((resolve) => {
        resolver = resolve;
      });
      return {
        promise,
        resolve: (value: unknown) => resolver?.(value)
      };
    };

    const firstResponse = createDeferredResponse();
    const secondResponse = createDeferredResponse();

    mockApplyFilter
      .mockImplementationOnce(() => firstResponse.promise as Promise<any>)
      .mockImplementationOnce(() => secondResponse.promise as Promise<any>);

    let applyFiltersFn: ((filters: FilterState[]) => Promise<void>) | null = null;
    render(
      <ControlHarness
        onReady={(applyFilters) => {
          applyFiltersFn = applyFilters;
        }}
      />
    );

    await waitFor(() => expect(applyFiltersFn).toBeTruthy());

    const firstFilter: FilterState = { ...baseFilter, id: 'first', value: 'first' };
    const secondFilter: FilterState = { ...baseFilter, id: 'second', value: 'second' };

    let firstPromise: Promise<void>;
    let secondPromise: Promise<void>;
    await act(async () => {
      firstPromise = applyFiltersFn!([firstFilter]);
      secondPromise = applyFiltersFn!([secondFilter]);
    });

    expect(mockApplyFilter).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondResponse.resolve({
        matchedRows: 200,
        totalRows: 500,
        predicateMatchCounts: null,
        fuzzyUsed: null
      });
      await secondPromise!;
    });
    expect(useDataStore.getState().matchedRows).toBe(200);

    await act(async () => {
      firstResponse.resolve({
        matchedRows: 5,
        totalRows: 500,
        predicateMatchCounts: null,
        fuzzyUsed: null
      });
      await firstPromise!;
    });
    expect(useDataStore.getState().matchedRows).toBe(200);
  });
});
