import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionPersistence } from './useSessionPersistence';
import { useSessionStore, type SessionSnapshot } from '@state/sessionStore';
import { resetStoredDataFlushStateForTests } from '@utils/persistenceReset';

const mockLoadSessionSnapshot = vi.fn();
const mockSaveSessionSnapshot = vi.fn();

vi.mock('@utils/sessionPersistence', () => ({
  loadSessionSnapshot: (...args: unknown[]) => mockLoadSessionSnapshot(...args),
  saveSessionSnapshot: (...args: unknown[]) => mockSaveSessionSnapshot(...args)
}));

vi.mock('@utils/autoSaveScheduler', () => ({
  AutoSaveScheduler: class {
    markDirty(): void {}
    dispose(): void {}
  }
}));

const buildSnapshot = (
  handle: FileSystemFileHandle | null
): SessionSnapshot => ({
  fileHandle: handle,
  filters: [],
  sorts: [],
  groups: [],
  groupAggregations: [],
  columnLayout: {
    order: [],
    visibility: {}
  },
  searchCaseSensitive: false,
  interfaceFontFamily: 'system',
  interfaceFontSize: 14,
  dataFontFamily: 'system',
  dataFontSize: 14,
  labels: [],
  tags: {},
  updatedAt: 123
});

describe('useSessionPersistence', () => {
  beforeEach(() => {
    resetStoredDataFlushStateForTests();
    mockLoadSessionSnapshot.mockReset();
    mockSaveSessionSnapshot.mockReset();
    mockSaveSessionSnapshot.mockResolvedValue({ updatedAt: Date.now() });
    useSessionStore.getState().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes a reconnect action when restore needs a user-triggered permission request', async () => {
    const handle = {
      name: 'events.csv',
      queryPermission: vi.fn().mockResolvedValueOnce('prompt').mockResolvedValueOnce('prompt'),
      requestPermission: vi.fn().mockResolvedValue('granted')
    } as unknown as FileSystemFileHandle;

    mockLoadSessionSnapshot.mockResolvedValue({
      snapshot: buildSnapshot(handle),
      handleMissing: false,
      fileName: 'events.csv'
    });

    const { result } = renderHook(() => useSessionPersistence(true));

    await waitFor(() => {
      expect(result.current.canReconnect).toBe(true);
      expect(result.current.reconnectFileName).toBe('events.csv');
      expect(result.current.error).toBe('Reconnect "events.csv" to continue.');
    });
    expect(useSessionStore.getState().fileHandle).toBeNull();

    await act(async () => {
      const reconnected = await result.current.reconnectFile();
      expect(reconnected).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.canReconnect).toBe(false);
      expect(result.current.reconnectFileName).toBeNull();
      expect(result.current.error).toBeNull();
    });
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
    expect(useSessionStore.getState().fileHandle).toBe(handle);
  });

  it('keeps reopen-only messaging when the persisted file handle is gone', async () => {
    mockLoadSessionSnapshot.mockResolvedValue({
      snapshot: buildSnapshot(null),
      handleMissing: true,
      fileName: 'old-events.csv'
    });

    const { result } = renderHook(() => useSessionPersistence(true));

    await waitFor(() => {
      expect(result.current.canReconnect).toBe(false);
      expect(result.current.reconnectFileName).toBe('old-events.csv');
      expect(result.current.error).toBe(
        'Previous file permission for "old-events.csv" expired. Reopen it to continue.'
      );
    });
  });
});
