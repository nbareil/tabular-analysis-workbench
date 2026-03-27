import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY } from '@state/appStore';
import { clearStoredData } from './clearStoredData';
import { DEBUG_STORAGE_KEY } from './debugLog';
import {
  isStoredDataFlushInProgress,
  resetStoredDataFlushStateForTests
} from './persistenceReset';

const mockClearActiveFileHandle = vi.fn();

vi.mock('./capabilities', () => ({
  supportsOpfs: () => true
}));

vi.mock('./sessionHandleStore', () => ({
  clearActiveFileHandle: (...args: unknown[]) => mockClearActiveFileHandle(...args)
}));

class StubRootDirectory {
  readonly removed: Array<{ name: string; options?: unknown }> = [];
  private readonly directories: Set<string>;

  constructor(names: string[]) {
    this.directories = new Set(names);
  }

  async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
    if (!this.directories.has(name)) {
      throw new Error(`Directory ${name} missing`);
    }

    return {} as FileSystemDirectoryHandle;
  }

  async removeEntry(name: string, options?: unknown): Promise<void> {
    this.removed.push({ name, options });
    this.directories.delete(name);
  }
}

describe('clearStoredData', () => {
  beforeEach(() => {
    mockClearActiveFileHandle.mockReset();
    mockClearActiveFileHandle.mockResolvedValue(undefined);
    resetStoredDataFlushStateForTests();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.localStorage.setItem(DEBUG_STORAGE_KEY, '1');
  });

  afterEach(() => {
    resetStoredDataFlushStateForTests();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('clears local storage, indexed handles, and OPFS directories', async () => {
    const root = new StubRootDirectory(['sessions', 'row-cache', 'row-index', 'annotations']);

    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn().mockResolvedValue(root)
      }
    });

    await clearStoredData();

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEBUG_STORAGE_KEY)).toBeNull();
    expect(mockClearActiveFileHandle).toHaveBeenCalledTimes(1);
    expect(root.removed).toEqual([
      { name: 'sessions', options: { recursive: true } },
      { name: 'row-cache', options: { recursive: true } },
      { name: 'row-index', options: { recursive: true } },
      { name: 'annotations', options: { recursive: true } }
    ]);
    expect(isStoredDataFlushInProgress()).toBe(true);
  });
});
