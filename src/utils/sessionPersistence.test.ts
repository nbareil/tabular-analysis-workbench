import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadSessionSnapshot
} from './sessionPersistence';
import { THEME_STORAGE_KEY } from '@state/appStore';
import {
  SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY,
  SESSION_RETENTION_MS
} from './persistenceRetention';

vi.mock('./capabilities', () => ({
  supportsOpfs: () => true
}));

vi.mock('./opfsQuotaManager', () => ({
  enforceOpfsBudget: vi.fn().mockResolvedValue(undefined)
}));

const mockClearActiveFileHandle = vi.fn();
const mockLoadActiveFileHandle = vi.fn();
const mockPersistActiveFileHandle = vi.fn();

vi.mock('./sessionHandleStore', () => ({
  ACTIVE_HANDLE_KEY: 'active-handle',
  clearActiveFileHandle: (...args: unknown[]) => mockClearActiveFileHandle(...args),
  loadActiveFileHandle: (...args: unknown[]) => mockLoadActiveFileHandle(...args),
  persistActiveFileHandle: (...args: unknown[]) => mockPersistActiveFileHandle(...args)
}));

class MemoryFileHandle {
  readonly kind = 'file' as const;
  constructor(public textContent: string) {}

  async getFile(): Promise<{
    size: number;
    text: () => Promise<string>;
  }> {
    return {
      size: this.textContent.length,
      text: async () => this.textContent
    };
  }

  async createWritable(): Promise<{
    write: (data: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
    abort: () => Promise<void>;
  }> {
    let nextValue = this.textContent;
    return {
      write: async (data) => {
        nextValue = new TextDecoder().decode(data);
      },
      close: async () => {
        this.textContent = nextValue;
      },
      abort: async () => undefined
    };
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly removed: Array<{ name: string; options?: FileSystemRemoveOptions }> = [];
  private readonly files = new Map<string, MemoryFileHandle>();
  private readonly directories = new Map<string, MemoryDirectoryHandle>();

  addDirectory(name: string, directory = new MemoryDirectoryHandle()): MemoryDirectoryHandle {
    this.directories.set(name, directory);
    return directory;
  }

  addFile(name: string, textContent: string): MemoryFileHandle {
    const handle = new MemoryFileHandle(textContent);
    this.files.set(name, handle);
    return handle;
  }

  async getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions
  ): Promise<FileSystemDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) {
      return existing as unknown as FileSystemDirectoryHandle;
    }

    if (options?.create) {
      const created = new MemoryDirectoryHandle();
      this.directories.set(name, created);
      return created as unknown as FileSystemDirectoryHandle;
    }

    throw new Error(`Directory ${name} missing`);
  }

  async getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions
  ): Promise<FileSystemFileHandle> {
    const existing = this.files.get(name);
    if (existing) {
      return existing as unknown as FileSystemFileHandle;
    }

    if (options?.create) {
      const created = new MemoryFileHandle('');
      this.files.set(name, created);
      return created as unknown as FileSystemFileHandle;
    }

    throw new Error(`File ${name} missing`);
  }

  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    this.removed.push({ name, options });
    this.files.delete(name);
    this.directories.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const [name, directory] of this.directories.entries()) {
      yield [name, directory as unknown as FileSystemHandle];
    }
    for (const [name, file] of this.files.entries()) {
      yield [name, file as unknown as FileSystemHandle];
    }
  }
}

const buildSessionEnvelope = (updatedAt: number): string =>
  JSON.stringify({
    version: 1,
    updatedAt,
    handleKey: null,
    fileName: 'events.csv',
    storageKey: 'events-csv-123-456',
    snapshot: {
      fileHandle: null,
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
      updatedAt
    }
  });

describe('session retention', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockClearActiveFileHandle.mockReset();
    mockLoadActiveFileHandle.mockReset();
    mockPersistActiveFileHandle.mockReset();
    mockClearActiveFileHandle.mockResolvedValue(undefined);
    mockLoadActiveFileHandle.mockResolvedValue(null);
    mockPersistActiveFileHandle.mockResolvedValue(null);
  });

  it('removes persisted workbench data after more than 3 weeks of inactivity', async () => {
    const root = new MemoryDirectoryHandle();
    const sessions = root.addDirectory('sessions');
    sessions.addFile('latest.json', buildSessionEnvelope(Date.now() - SESSION_RETENTION_MS));
    root.addDirectory('row-cache');
    root.addDirectory('row-index');
    root.addDirectory('annotations');

    vi.stubGlobal('navigator', {
      ...navigator,
      storage: {
        getDirectory: vi.fn().mockResolvedValue(root)
      }
    });

    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.localStorage.setItem(
      SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY,
      JSON.stringify({
        'events-csv-123-456': Date.now() - SESSION_RETENTION_MS - 1_000
      })
    );

    const snapshot = await loadSessionSnapshot();

    expect(snapshot).toBeNull();
    expect(mockClearActiveFileHandle).toHaveBeenCalledTimes(1);
    expect(root.removed).toEqual([{ name: 'sessions', options: { recursive: true } }]);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(window.localStorage.getItem(SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY)).toBe(
      '{}'
    );
  });

  it('keeps persisted data when the inactivity window has not elapsed', async () => {
    const root = new MemoryDirectoryHandle();
    const sessions = root.addDirectory('sessions');
    const updatedAt = Date.now() - 60_000;
    sessions.addFile('latest.json', buildSessionEnvelope(updatedAt));

    vi.stubGlobal('navigator', {
      ...navigator,
      storage: {
        getDirectory: vi.fn().mockResolvedValue(root)
      }
    });

    window.localStorage.setItem(
      SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY,
      JSON.stringify({
        'events-csv-123-456': Date.now() - SESSION_RETENTION_MS + 60_000
      })
    );

    const snapshot = await loadSessionSnapshot();

    expect(snapshot?.fileName).toBe('events.csv');
    expect(snapshot?.snapshot.updatedAt).toBe(updatedAt);
    expect(root.removed).toEqual([]);
    expect(mockClearActiveFileHandle).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        window.localStorage.getItem(SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY) ?? '{}'
      )['events-csv-123-456']
    ).toBeGreaterThan(Date.now() - 5_000);
  });
});
