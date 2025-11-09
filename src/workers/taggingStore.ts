import { logDebug } from '../utils/debugLog';
import type { FuzzyIndexFingerprint } from './fuzzyIndexStore';
import type { TaggingSnapshot } from './types';

const TAG_DIRECTORY = 'annotations';
const TAG_FILE_NAME = 'tags.json';
const TAG_TEMP_FILE_NAME = 'tags.tmp.json';
const TAG_STORE_VERSION = 1;

const textEncoder = new TextEncoder();

interface TaggingEnvelope {
  version: number;
  updatedAt: number;
  payload: TaggingSnapshot;
}

const supportsOpfs = (): boolean => {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  );
};

export class TaggingStore {
  private readonly directory: FileSystemDirectoryHandle | null;
  private readonly handle: FileSystemFileHandle | null;

  private constructor(
    directory: FileSystemDirectoryHandle | null,
    handle: FileSystemFileHandle | null
  ) {
    this.directory = directory;
    this.handle = handle;
  }

  static async create(): Promise<TaggingStore> {
    if (!supportsOpfs()) {
      return new TaggingStore(null, null);
    }

    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(TAG_DIRECTORY, { create: true });
      const handle = await directory.getFileHandle(TAG_FILE_NAME, { create: true });

      if (import.meta.env?.DEV) {
        logDebug('tagging-store', 'created tagging store', {
          fileName: TAG_FILE_NAME,
          directory: TAG_DIRECTORY
        });
      }

      return new TaggingStore(directory, handle);
    } catch (error) {
      console.warn('[tagging-store] Failed to initialise OPFS handles', error);
      return new TaggingStore(null, null);
    }
  }

  async load(): Promise<TaggingSnapshot | null> {
    if (!this.handle) {
      return null;
    }

    try {
      const file = await this.handle.getFile();
      if (file.size === 0) {
        return null;
      }

      const json = await file.text();
      const parsed = JSON.parse(json) as Partial<TaggingEnvelope>;

      if (!parsed || parsed.version !== TAG_STORE_VERSION || !parsed.payload) {
        return null;
      }

      return parsed.payload;
    } catch (error) {
      console.warn('[tagging-store] Failed to load snapshot', error);
      return null;
    }
  }

  async save(snapshot: TaggingSnapshot): Promise<void> {
    if (!this.directory || !this.handle) {
      return;
    }

    const envelope: TaggingEnvelope = {
      version: TAG_STORE_VERSION,
      updatedAt: Date.now(),
      payload: snapshot
    };

    // Atomic write: write to temp file, then move
    const tempHandle = await this.directory.getFileHandle(TAG_TEMP_FILE_NAME, { create: true });
    const writable = await tempHandle.createWritable({ keepExistingData: false });
    try {
      const data = textEncoder.encode(JSON.stringify(envelope));
      await writable.write(data);
      await writable.close();

      // Move temp to final (atomic replace)
      await (this.directory as any).move(TAG_TEMP_FILE_NAME, TAG_FILE_NAME);
    } catch (error) {
      await writable.abort();
      console.warn('[tagging-store] Failed to persist snapshot', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    if (!this.directory) {
      return;
    }

    try {
      await this.directory.removeEntry(TAG_FILE_NAME);
    } catch (error) {
      console.warn('[tagging-store] Failed to clear snapshot', error);
    }
  }
}
