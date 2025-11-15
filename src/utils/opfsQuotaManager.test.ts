import { describe, expect, it, beforeEach, vi } from 'vitest';

import { enforceOpfsBudget, type OpfsEntry } from './opfsQuotaManager';

type FileRecord = { size: number; lastModified: number };

class StubFile {
  readonly size: number;
  readonly lastModified: number;
  constructor(record: FileRecord) {
    this.size = record.size;
    this.lastModified = record.lastModified;
  }
}

class StubFileHandle {
  private record: FileRecord;
  constructor(record: FileRecord) {
    this.record = record;
  }

  async getFile(): Promise<StubFile> {
    return new StubFile(this.record);
  }
}

class StubDirectoryHandle {
  private entriesMap: Map<string, StubFileHandle>;
  constructor(entries: Record<string, FileRecord>) {
    this.entriesMap = new Map(
      Object.entries(entries).map(([name, record]) => [name, new StubFileHandle(record)])
    );
  }

  async *entries(): AsyncGenerator<[string, StubFileHandle]> {
    for (const entry of this.entriesMap.entries()) {
      yield entry;
    }
  }

  async removeEntry(name: string): Promise<void> {
    this.entriesMap.delete(name);
  }
}

class StubRootDirectory {
  private directories: Map<string, StubDirectoryHandle>;

  constructor(entries: Record<string, Record<string, FileRecord>>) {
    this.directories = new Map(
      Object.entries(entries).map(([name, files]) => [name, new StubDirectoryHandle(files)])
    );
  }

  async getDirectoryHandle(name: string): Promise<StubDirectoryHandle> {
    const directory = this.directories.get(name);
    if (!directory) {
      throw new Error(`Directory ${name} missing`);
    }
    return directory;
  }
}

vi.mock('./capabilities', () => {
  return {
    supportsOpfs: () => true
  };
});

describe('enforceOpfsBudget', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('removes oldest low-priority cache files first when exceeding the budget', async () => {
    const root = new StubRootDirectory({
      'row-cache': {
        'dataset-a.bin': { size: 120 * 1024 * 1024, lastModified: 10 },
        'dataset-b.bin': { size: 90 * 1024 * 1024, lastModified: 5 }
      },
      sessions: {
        'latest.json': { size: 2 * 1024 * 1024, lastModified: 20 },
        'snapshot-1.json': { size: 4 * 1024 * 1024, lastModified: 15 }
      }
    });

    const { removed } = await enforceOpfsBudget({
      maxBytes: 150 * 1024 * 1024,
      root: root as unknown as FileSystemDirectoryHandle,
      preserve: (entry: OpfsEntry) => entry.directory === 'sessions' && entry.name === 'latest.json'
    });

    // row-cache entries should be pruned before touching sessions.
    expect(removed).toEqual([
      { directory: 'row-cache', name: 'dataset-b.bin' }
    ]);
  });

  it('never deletes preserved files even if still above budget', async () => {
    const root = new StubRootDirectory({
      sessions: {
        'latest.json': { size: 210 * 1024 * 1024, lastModified: 30 }
      }
    });

    const { removed } = await enforceOpfsBudget({
      maxBytes: 200 * 1024 * 1024,
      root: root as unknown as FileSystemDirectoryHandle,
      preserve: (entry) => entry.name === 'latest.json'
    });

    expect(removed).toEqual([]);
  });
});
