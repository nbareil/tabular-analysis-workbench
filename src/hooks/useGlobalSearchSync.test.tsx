import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalSearchSync } from './useGlobalSearchSync';
import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';

const mockGlobalSearch = vi.fn();
const mockClearSearch = vi.fn();
const mockApplySorts = vi.fn();

vi.mock('@workers/dataWorkerProxy', () => {
  return {
    getDataWorker: () => ({
      globalSearch: mockGlobalSearch,
      clearSearch: mockClearSearch,
      applySorts: mockApplySorts
    })
  };
});

const Harness = ({
  query,
  columns,
  enabled
}: {
  query: string;
  columns: string[];
  enabled: boolean;
}): null => {
  useGlobalSearchSync({ query, columns, enabled });
  return null;
};

const resetStores = () => {
  useSessionStore.setState((state) => ({
    ...state,
    sorts: [],
    searchCaseSensitive: false,
    updatedAt: Date.now()
  }));
  useDataStore.setState((state) => ({
    ...state,
    status: 'ready',
    totalRows: 100,
    matchedRows: 100,
    filterMatchedRows: null,
    searchMatchedRows: null,
    message: null,
    viewVersion: 0
  }));
};

describe('useGlobalSearchSync', () => {
  beforeEach(() => {
    mockGlobalSearch.mockReset();
    mockClearSearch.mockReset();
    mockApplySorts.mockReset();
    resetStores();
  });

  afterEach(() => {
    cleanup();
  });

  it('ignores stale search responses that resolve out of order', async () => {
    const createDeferredResponse = () => {
      let resolver: ((value: { totalRows: number; matchedRows: number }) => void) | null = null;
      const promise = new Promise<{ totalRows: number; matchedRows: number }>((resolve) => {
        resolver = resolve;
      });
      return {
        promise,
        resolve: (value: { totalRows: number; matchedRows: number }) => resolver?.(value)
      };
    };

    const firstResponse = createDeferredResponse();
    const secondResponse = createDeferredResponse();

    mockGlobalSearch
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);

    const view = render(<Harness query="alp" columns={['message']} enabled />);

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    view.rerender(<Harness query="alpha" columns={['message']} enabled />);

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    expect(mockGlobalSearch).toHaveBeenCalledTimes(2);
    expect(mockGlobalSearch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        requestId: 1,
        query: 'alp',
        columns: ['message']
      })
    );
    expect(mockGlobalSearch.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        requestId: 2,
        query: 'alpha',
        columns: ['message']
      })
    );

    await act(async () => {
      secondResponse.resolve({ totalRows: 100, matchedRows: 12 });
      await secondResponse.promise;
    });
    expect(useDataStore.getState().matchedRows).toBe(12);

    await act(async () => {
      firstResponse.resolve({ totalRows: 100, matchedRows: 3 });
      await firstResponse.promise;
    });
    expect(useDataStore.getState().matchedRows).toBe(12);
  });

  it('clears active search state and reapplies sorts when the query is emptied', async () => {
    useSessionStore.setState((state) => ({
      ...state,
      sorts: [{ column: 'message', direction: 'asc' }]
    }));
    useDataStore.setState((state) => ({
      ...state,
      searchMatchedRows: 5,
      matchedRows: 5
    }));

    render(<Harness query="" columns={['message']} enabled />);

    await waitFor(() =>
      expect(mockClearSearch).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 1 })
      )
    );
    expect(mockApplySorts).toHaveBeenCalledWith(
      expect.objectContaining({
        sorts: [{ column: 'message', direction: 'asc' }]
      })
    );
    expect(useDataStore.getState().searchMatchedRows).toBeNull();
  });
});
