// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDatasetStorageKey, createDatasetFingerprint, type DatasetFingerprint } from './datasetFingerprint';
import { ANNOTATION_RETENTION_MS, TAG_DIRECTORY, TaggingStore } from './taggingStore';
import type { TaggingSnapshot } from './types';

interface Entry {
  data: string;
  lastModified: number;
}

/** In-memory OPFS directory exposing just what TaggingStore uses. */
const createMemoryDirectory = () => {
  const entries = new Map<string, Entry>();
  const writes: string[] = [];
  const fileHandle = (name: string) => ({
    kind: 'file' as const,
    name,
    getFile: async () => {
      const entry = entries.get(name)!;
      return new File([entry.data], name, { lastModified: entry.lastModified });
    },
    createWritable: async () => {
      writes.push(name);
      let buffer = '';
      return {
        write: async (chunk: string) => {
          buffer += chunk;
        },
        close: async () => {
          entries.set(name, { data: buffer, lastModified: Date.now() });
        },
        abort: async () => undefined
      };
    }
  });
  const directory = {
    kind: 'directory' as const,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!entries.has(name)) {
        if (!options?.create) {
          throw new DOMException('Not found', 'NotFoundError');
        }
        entries.set(name, { data: '', lastModified: Date.now() });
      }
      return fileHandle(name);
    },
    async *entries() {
      for (const name of Array.from(entries.keys())) {
        yield [name, fileHandle(name)] as const;
      }
    },
    removeEntry: async (name: string) => {
      entries.delete(name);
    }
  };
  return { entries, writes, directory };
};

const fingerprint: DatasetFingerprint = { fileName: 'Case File.csv', fileSize: 123_456, lastModified: 1_730_000_000_000 };
const currentName = `tags-${buildDatasetStorageKey(fingerprint)}.json`;
const snapshot: TaggingSnapshot = {
  labels: [{ id: 'a', name: 'A', color: '#fff', createdAt: 1, updatedAt: 1 }],
  tags: { 3: { labelIds: ['a'], note: 'hi', updatedAt: 2 } }
};

describe('dataset storage key', () => {
  it('slugifies the file name and appends size and timestamp', () => {
    expect(buildDatasetStorageKey(fingerprint)).toBe('case-file-csv-123456-1730000000000');
  });

  it('falls back to a dataset prefix when metadata is missing', () => {
    expect(buildDatasetStorageKey({ fileName: '', fileSize: NaN, lastModified: NaN })).toBe('dataset-0-0');
  });

  it('fingerprints several files by joined names, summed sizes and latest mtime', () => {
    const files = [
      new File(['abc'], 'a.csv', { lastModified: 10 }),
      new File(['de'], 'b.csv', { lastModified: 30 })
    ];
    expect(createDatasetFingerprint(files)).toEqual({ fileName: 'a.csv+b.csv', fileSize: 5, lastModified: 30 });
  });
});

describe('TaggingStore', () => {
  let memory: ReturnType<typeof createMemoryDirectory>;

  beforeEach(() => {
    memory = createMemoryDirectory();
    const root = {
      getDirectoryHandle: async (name: string) => {
        expect(name).toBe(TAG_DIRECTORY);
        return memory.directory;
      }
    };
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a no-op without OPFS', async () => {
    vi.stubGlobal('navigator', { storage: undefined });
    const store = await TaggingStore.create(fingerprint);
    await store.save(snapshot);
    expect(await store.load()).toBeNull();
    expect(memory.entries.size).toBe(0);
  });

  it('saves the snapshot as JSON directly to the dataset file', async () => {
    const store = await TaggingStore.create(fingerprint);
    await store.save(snapshot);
    expect(Array.from(memory.entries.keys())).toEqual([currentName]);
    expect(memory.writes).toEqual([currentName]);
    expect(JSON.parse(memory.entries.get(currentName)!.data)).toEqual(snapshot);
  });

  it('returns null for a new or unreadable snapshot', async () => {
    const store = await TaggingStore.create(fingerprint);
    expect(await store.load()).toBeNull();
    memory.entries.set(currentName, { data: '{not json', lastModified: Date.now() });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await store.load()).toBeNull();
  });

  it('loads the snapshot and touches it to restart its retention clock', async () => {
    const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
    memory.entries.set(currentName, { data: JSON.stringify(snapshot), lastModified: old });
    const store = await TaggingStore.create(fingerprint);
    expect(await store.load()).toEqual(snapshot);
    expect(memory.writes).toEqual([currentName]);
    expect(memory.entries.get(currentName)!.lastModified).toBeGreaterThan(old);
    expect(JSON.parse(memory.entries.get(currentName)!.data)).toEqual(snapshot);
  });

  it('prunes snapshots of other files older than the retention window, keeping the current one', async () => {
    const now = Date.now();
    const expired = now - ANNOTATION_RETENTION_MS - 60_000;
    memory.entries.set('tags-expired.json', { data: '{}', lastModified: expired });
    memory.entries.set('tags-recent.json', { data: '{}', lastModified: now - 24 * 60 * 60 * 1000 });
    memory.entries.set(currentName, { data: JSON.stringify(snapshot), lastModified: expired });

    const store = await TaggingStore.create(fingerprint);

    expect(Array.from(memory.entries.keys()).sort()).toEqual([currentName, 'tags-recent.json'].sort());
    expect(await store.load()).toEqual(snapshot);
  });
});
