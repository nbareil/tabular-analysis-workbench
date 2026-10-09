import { buildDatasetStorageKey, type DatasetFingerprint } from './datasetFingerprint';
import type { TaggingSnapshot } from './types';

export const TAG_DIRECTORY = 'annotations';
/** Annotations for files that have not been opened for this long are deleted. */
export const ANNOTATION_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Persists one dataset's labels and notes as JSON in OPFS.
 * `createWritable()` writes to a swap file that replaces the target atomically on `close()`,
 * so a crash mid-write leaves the previous snapshot intact.
 */
export class TaggingStore {
  private constructor(private readonly handle: FileSystemFileHandle | null) {}

  /**
   * Opens the store for a file, first deleting snapshots of other files that were not opened within
   * the retention window. Opening a file touches its snapshot, which restarts its retention clock.
   */
  static async create(fingerprint: DatasetFingerprint): Promise<TaggingStore> {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
      return new TaggingStore(null);
    }
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(TAG_DIRECTORY, { create: true });
    const fileName = `tags-${buildDatasetStorageKey(fingerprint)}.json`;
    await pruneExpiredSnapshots(directory, fileName);
    return new TaggingStore(await directory.getFileHandle(fileName, { create: true }));
  }

  async load(): Promise<TaggingSnapshot | null> {
    if (!this.handle) {
      return null;
    }
    const file = await this.handle.getFile();
    if (file.size === 0) {
      return null;
    }
    let snapshot: TaggingSnapshot;
    try {
      snapshot = JSON.parse(await file.text()) as TaggingSnapshot;
    } catch (error) {
      console.warn('[tagging-store] Ignoring unreadable snapshot', error);
      return null;
    }
    await this.save(snapshot);
    return snapshot;
  }

  async save(snapshot: TaggingSnapshot): Promise<void> {
    if (!this.handle) {
      return;
    }
    const writable = await this.handle.createWritable({ keepExistingData: false });
    try {
      await writable.write(JSON.stringify(snapshot));
    } catch (error) {
      await writable.abort();
      throw error;
    }
    await writable.close();
  }
}

const pruneExpiredSnapshots = async (directory: FileSystemDirectoryHandle, keep: string): Promise<void> => {
  const cutoff = Date.now() - ANNOTATION_RETENTION_MS;
  const expired: string[] = [];
  for await (const [name, handle] of (
    directory as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
  ).entries()) {
    if (name !== keep && handle.kind === 'file' && (await (handle as FileSystemFileHandle).getFile()).lastModified < cutoff) {
      expired.push(name);
    }
  }
  for (const name of expired) {
    await directory.removeEntry(name).catch(() => undefined);
  }
};
