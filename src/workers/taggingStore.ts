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

const sanitizeSegment = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
};

export const buildTaggingStoreKey = (fingerprint: FuzzyIndexFingerprint): string => {
  const baseName =
    typeof fingerprint.fileName === 'string' && fingerprint.fileName.trim().length > 0
      ? fingerprint.fileName
      : 'dataset';
  const fileName = sanitizeSegment(baseName) || 'dataset';
  const fileSize =
    typeof fingerprint.fileSize === 'number' && Number.isFinite(fingerprint.fileSize)
      ? Math.max(0, Math.floor(fingerprint.fileSize))
      : 0;
  const lastModified =
    typeof fingerprint.lastModified === 'number' && Number.isFinite(fingerprint.lastModified)
      ? Math.max(0, Math.floor(fingerprint.lastModified))
      : 0;

  return `${fileName}-${fileSize}-${lastModified}`;
};

const buildFileNames = (key: string): { data: string; temp: string } => {
  const prefix = `${TAG_FILE_PREFIX}-${key}`;
  return {
    data: `${prefix}.json`,
    temp: `${prefix}.tmp.json`
  };
};

export class TaggingStore {
  private readonly directory: FileSystemDirectoryHandle | null;
  private readonly handle: FileSystemFileHandle | null;
  private readonly fileName: string | null;
  private readonly tempFileName: string | null;
  private readonly storeKey: string | null;

  private constructor(
    directory: FileSystemDirectoryHandle | null,
    handle: FileSystemFileHandle | null,
    fileName: string | null,
    tempFileName: string | null,
    storeKey: string | null
  ) {
    this.directory = directory;
    this.handle = handle;
    this.fileName = fileName;
    this.tempFileName = tempFileName;
    this.storeKey = storeKey;
  }

  static async create(fingerprint: FuzzyIndexFingerprint | null): Promise<TaggingStore> {
    if (!supportsOpfs() || !fingerprint) {
      return new TaggingStore(null, null, null, null, null);
    }

    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(TAG_DIRECTORY, { create: true });
      const storeKey = buildTaggingStoreKey(fingerprint);
      const { data, temp } = buildFileNames(storeKey);
      const handle = await directory.getFileHandle(data, { create: true });

      if (import.meta.env?.DEV) {
        logDebug('tagging-store', 'created tagging store', {
          fileName: data,
          directory: TAG_DIRECTORY,
          fingerprint
        });
      }

      return new TaggingStore(directory, handle, data, temp, storeKey);
    } catch (error) {
      console.warn('[tagging-store] Failed to initialise OPFS handles', error);
      return new TaggingStore(null, null, null, null, null);
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
    if (!this.directory || !this.handle || !this.fileName || !this.tempFileName) {
      return;
    }

    const envelope: TaggingEnvelope = {
      version: TAG_STORE_VERSION,
      updatedAt: Date.now(),
      payload: snapshot
    };

    // Atomic write: write to temp file, then move
    const tempHandle = await this.directory.getFileHandle(this.tempFileName, { create: true });
    const writable = await tempHandle.createWritable({ keepExistingData: false });
    try {
      const data = textEncoder.encode(JSON.stringify(envelope));
      await writable.write(data);
      await writable.close();

      // Move temp to final (atomic replace)
      await (this.directory as any).move(this.tempFileName, this.fileName);
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
