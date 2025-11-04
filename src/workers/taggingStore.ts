import { logDebug } from '../utils/debugLog';
import type { FuzzyIndexFingerprint } from './fuzzyIndexStore';
import type { TaggingSnapshot } from './types';

const TAG_DIRECTORY = 'annotations';
const TAG_FILE_PREFIX = 'tags';
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

const sanitizePathComponent = (value: string): string => {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'dataset';
};

const buildFileName = (fingerprint: FuzzyIndexFingerprint): string => {
  const safeName = sanitizePathComponent(fingerprint.fileName);
  const safeSize = Number.isFinite(fingerprint.fileSize) ? Math.max(0, Math.floor(fingerprint.fileSize)) : 0;
  const safeTimestamp = Number.isFinite(fingerprint.lastModified) ? Math.max(0, Math.floor(fingerprint.lastModified)) : 0;
  return `${TAG_FILE_PREFIX}-${safeName}-${safeSize}-${safeTimestamp}.json`;
};

export class TaggingStore {
  private readonly directory: FileSystemDirectoryHandle | null;
  private readonly handle: FileSystemFileHandle | null;
  private readonly fileName: string | null;

  private constructor(
    directory: FileSystemDirectoryHandle | null,
    handle: FileSystemFileHandle | null,
    fileName: string | null
  ) {
    this.directory = directory;
    this.handle = handle;
    this.fileName = fileName;
  }

  static async create(
    source: FileSystemFileHandle,
    fingerprint: FuzzyIndexFingerprint
  ): Promise<TaggingStore> {
    if (!supportsOpfs()) {
      return new TaggingStore(null, null, null);
    }

    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(TAG_DIRECTORY, { create: true });
      const fileName = buildFileName(fingerprint);
      const handle = await directory.getFileHandle(fileName, { create: true });

      if (import.meta.env?.DEV) {
        logDebug('tagging-store', 'created tagging store', {
          fileName,
          directory: TAG_DIRECTORY
        });
      }

      return new TaggingStore(directory, handle, fileName);
    } catch (error) {
      console.warn('[tagging-store] Failed to initialise OPFS handles', error);
      return new TaggingStore(null, null, null);
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
    if (!this.handle) {
      return;
    }

    const envelope: TaggingEnvelope = {
      version: TAG_STORE_VERSION,
      updatedAt: Date.now(),
      payload: snapshot
    };

    const writable = await this.handle.createWritable({ keepExistingData: false });
    try {
      const data = textEncoder.encode(JSON.stringify(envelope));
      await writable.write(data);
      await writable.close();
    } catch (error) {
      await writable.abort();
      console.warn('[tagging-store] Failed to persist snapshot', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    if (!this.directory || !this.fileName) {
      return;
    }

    try {
      await this.directory.removeEntry(this.fileName);
    } catch (error) {
      console.warn('[tagging-store] Failed to clear snapshot', error);
    }
  }
}
