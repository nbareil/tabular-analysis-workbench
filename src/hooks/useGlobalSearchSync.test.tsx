import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalSearchSync } from './useGlobalSearchSync';
import { useAppStore } from '@state/appStore';
import { useDataStore } from '@state/dataStore';

const mockGlobalSearch = vi.fn();

vi.mock('@workers/dataWorkerProxy', async () => {
  const actual = await vi.importActual<typeof import('@workers/dataWorkerProxy')>('@workers/dataWorkerProxy');
  return { ...actual, getDataWorker: () => ({ globalSearch: mockGlobalSearch }) };
});

interface Props {
  query: string;
  columns: string[];
  enabled: boolean;
}

const columns = ['message'];

const renderSearch = (initial: Props) => renderHook((props: Props) => useGlobalSearchSync(props), { initialProps: initial });

const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useGlobalSearchSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGlobalSearch.mockReset();
    mockGlobalSearch.mockResolvedValue({ totalRows: 100, matchedRows: 12 });
    useAppStore.setState({ searchCaseSensitive: false });
    useDataStore.getState().reset();
    useDataStore.setState({ status: 'ready', totalRows: 100, matchedRows: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces typing into a single search with the trimmed query', async () => {
    const { rerender } = renderSearch({ query: 'al', columns, enabled: true });
    await flush(100);
    rerender({ query: ' alpha ', columns, enabled: true });
    await flush(249);
    expect(mockGlobalSearch).not.toHaveBeenCalled();

    await flush(1);
    expect(mockGlobalSearch).toHaveBeenCalledTimes(1);
    expect(mockGlobalSearch).toHaveBeenCalledWith({ query: 'alpha', columns, caseSensitive: false });
    expect(useDataStore.getState()).toMatchObject({ searchActive: true, matchedRows: 12 });
  });

  it('passes the case-sensitivity preference', async () => {
    useAppStore.setState({ searchCaseSensitive: true });
    renderSearch({ query: 'Alpha', columns, enabled: true });
    await flush(250);
    expect(mockGlobalSearch).toHaveBeenCalledWith(expect.objectContaining({ caseSensitive: true }));
  });

  it('does nothing while disabled or when the query is empty and no search is active', async () => {
    const { rerender } = renderSearch({ query: 'alpha', columns, enabled: false });
    await flush(500);
    rerender({ query: '', columns, enabled: true });
    await flush(500);
    expect(mockGlobalSearch).not.toHaveBeenCalled();
  });

  it('clears an active search immediately when the query is emptied', async () => {
    const { rerender } = renderSearch({ query: 'alpha', columns, enabled: true });
    await flush(250);
    expect(useDataStore.getState().searchActive).toBe(true);

    mockGlobalSearch.mockResolvedValue({ totalRows: 100, matchedRows: 100 });
    rerender({ query: '', columns, enabled: true });
    await flush(0);

    expect(mockGlobalSearch).toHaveBeenLastCalledWith({ query: '', columns, caseSensitive: false });
    expect(useDataStore.getState()).toMatchObject({ searchActive: false, matchedRows: 100 });
  });

  it('ignores stale-operation rejections', async () => {
    mockGlobalSearch.mockRejectedValue(Object.assign(new Error('stale'), { name: 'StaleOperationError' }));
    renderSearch({ query: 'alpha', columns, enabled: true });
    await flush(250);
    expect(useDataStore.getState().errorDetails).toBeNull();
    expect(useDataStore.getState().searchActive).toBe(false);
  });

  it('reports other errors without changing the load status', async () => {
    mockGlobalSearch.mockRejectedValue(new Error('boom'));
    renderSearch({ query: 'alpha', columns, enabled: true });
    await flush(250);
    expect(useDataStore.getState().status).toBe('ready');
    expect(useDataStore.getState().errorDetails).toMatchObject({
      message: 'Failed to perform global search',
      payload: { operation: 'grid.search' }
    });
  });
});
