import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDataStore } from '@state/dataStore';
import { useSessionStore } from '@state/sessionStore';

import { useSortSync } from './useSortSync';

const mockApplySorts = vi.fn();

vi.mock('@workers/dataWorkerProxy', () => {
  return {
    getDataWorker: () => ({
      applySorts: mockApplySorts
    })
  };
});

const TestHarness = (): null => {
  useSortSync();
  return null;
};

describe('useSortSync', () => {
  beforeEach(() => {
    mockApplySorts.mockReset();
    mockApplySorts.mockResolvedValue({
      rows: [],
      totalRows: 100,
      matchedRows: 100,
      sorts: [{ column: 'timestamp', direction: 'desc' }]
    });
    useSessionStore.setState((state) => ({
      ...state,
      sorts: [{ column: 'timestamp', direction: 'desc' }],
      updatedAt: Date.now()
    }));
    useDataStore.setState((state) => ({
      ...state,
      status: 'idle',
      totalRows: 0,
      matchedRows: null
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it('waits for the dataset to be ready before reapplying persisted sorts', async () => {
    render(<TestHarness />);

    expect(mockApplySorts).not.toHaveBeenCalled();

    await act(async () => {
      useDataStore.setState((state) => ({
        ...state,
        status: 'loading',
        totalRows: 25
      }));
    });

    expect(mockApplySorts).not.toHaveBeenCalled();

    await act(async () => {
      useDataStore.setState((state) => ({
        ...state,
        status: 'ready',
        totalRows: 100
      }));
    });

    await waitFor(() => {
      expect(mockApplySorts).toHaveBeenCalledTimes(1);
    });
  });
});
