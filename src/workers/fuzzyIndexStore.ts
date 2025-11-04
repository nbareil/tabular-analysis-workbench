import { logDebug } from '../utils/debugLog';

const INDEX_DIRECTORY = 'fuzzy-index';
const FILE_SUFFIX = '.fuzzy_index.json';
const STORE_VERSION = 1;

export const FUZZY_INDEX_STORE_VERSION = STORE_VERSION;

const textEncoder = new TextEncoder();

export interface FuzzyIndexFingerprint {
  fileName: string;
  fileSize: number;
  lastModified: number;
}

export interface FuzzyTokenEntry {
  id: number;
  token: string;
  frequency: number;
}

export interface FuzzyColumnSnapshot {
  key: string;
  truncated: boolean;
  tokens: FuzzyTokenEntry[];
  trigramIndex: Record<string, Uint32Array>;
}

export interface FuzzyIndexSnapshot {
  version: number;
  createdAt: number;
  rowCount: number;
  bytesParsed: number;
  tokenLimit: number;
  trigramSize: number;
  fingerprint: FuzzyIndexFingerprint;
  columns: FuzzyColumnSnapshot[];
}

interface SerializedFuzzyColumnSnapshot {
  key: string;
  truncated: boolean;
  tokens: FuzzyTokenEntry[];
  trigramIndex: Record<string, number[]>;
}

interface SerializedFuzzyIndexSnapshot {
  version: number;
  createdAt: number;
  rowCount: number;
  bytesParsed: number;
  tokenLimit: number;
  trigramSize: number;
  fingerprint: FuzzyIndexFingerprint;
  columns: SerializedFuzzyColumnSnapshot[];
}

const supportsOpfs = (): boolean => {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  );
};

const sanitizeFileName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'fuzzy_index';
};

const toSerializedColumn = (column: FuzzyColumnSnapshot): SerializedFuzzyColumnSnapshot => {
  const serializedIndex: Record<string, number[]> = {};

  for (const [trigram, tokenIds] of Object.entries(column.trigramIndex)) {
    serializedIndex[trigram] = Array.from(tokenIds);
  }

  return {
    key: column.key,
    truncated: column.truncated,
    tokens: column.tokens,
    trigramIndex: serializedIndex
  };
};

const fromSerializedColumn = (
  column: SerializedFuzzyColumnSnapshot
): FuzzyColumnSnapshot | null => {
  const trigramIndex: Record<string, Uint32Array> = {};
  for (const [trigram, tokenIds] of Object.entries(column.trigramIndex)) {
    if (!Array.isArray(tokenIds)) {
      return null;
    }

    const clamped = tokenIds
      .map((value) =>
        Number.isFinite(value) && value >= 0 ? Math.min(value, 0xffffffff) >>> 0 : null
      )
      .filter((value): value is number => value != null);

    trigramIndex[trigram] = Uint32Array.from(clamped);
  }

  return {
    key: column.key,
    truncated: column.truncated,
    tokens: column.tokens,
    trigramIndex
  };
};

export const serializeFuzzyIndexSnapshot = (
  snapshot: FuzzyIndexSnapshot
): SerializedFuzzyIndexSnapshot => {
  return {
    version: STORE_VERSION,
    createdAt: snapshot.createdAt,
    rowCount: snapshot.rowCount,
    bytesParsed: snapshot.bytesParsed,
    tokenLimit: snapshot.tokenLimit,
    trigramSize: snapshot.trigramSize,
    fingerprint: snapshot.fingerprint,
    columns: snapshot.columns.map(toSerializedColumn)
  };
};

export const deserializeFuzzyIndexSnapshot = (
  payload: unknown
): FuzzyIndexSnapshot | null => {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('version' in payload) ||
    (payload as { version: unknown }).version !== STORE_VERSION
  ) {
    return null;
  }

  const snapshot = payload as SerializedFuzzyIndexSnapshot;

  if (!Array.isArray(snapshot.columns)) {
    return null;
  }

  if (
    !snapshot.fingerprint ||
    typeof snapshot.fingerprint !== 'object' ||
    typeof snapshot.fingerprint.fileName !== 'string' ||
    typeof snapshot.fingerprint.fileSize !== 'number' ||
    typeof snapshot.fingerprint.lastModified !== 'number'
  ) {
    return null;
  }

  const columns: FuzzyColumnSnapshot[] = [];
  for (const column of snapshot.columns) {
    const parsed = fromSerializedColumn(column);
    if (!parsed) {
      return null;
    }
    columns.push(parsed);
  }

  return {
    version: STORE_VERSION,
    createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : Date.now(),
    rowCount: typeof snapshot.rowCount === 'number' ? snapshot.rowCount : 0,
    bytesParsed: typeof snapshot.bytesParsed === 'number' ? snapshot.bytesParsed : 0,
    tokenLimit: typeof snapshot.tokenLimit === 'number' ? snapshot.tokenLimit : 0,
    trigramSize: typeof snapshot.trigramSize === 'number' ? snapshot.trigramSize : 3,
    fingerprint: snapshot.fingerprint,
    columns
  };
};

const getIndexFileContext = async (
  source: FileSystemFileHandle
): Promise<{
  directory: FileSystemDirectoryHandle;
  fileName: string;
  handle: FileSystemFileHandle;
}> => {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(INDEX_DIRECTORY, { create: true });
  const fileName = `${sanitizeFileName(source.name)}${FILE_SUFFIX}`;
  const handle = await dir.getFileHandle(fileName, { create: true });
  return { directory: dir, fileName, handle };
};

export class FuzzyIndexStore {
  private readonly handle: FileSystemFileHandle | null;
  private readonly directory: FileSystemDirectoryHandle | null;
  private readonly fileName: string | null;

  private constructor(
    handle: FileSystemFileHandle | null,
    directory: FileSystemDirectoryHandle | null,
    fileName: string | null
  ) {
    this.handle = handle;
    this.directory = directory;
    this.fileName = fileName;
  }

  static async create(source: FileSystemFileHandle): Promise<FuzzyIndexStore> {
    if (!supportsOpfs()) {
      return new FuzzyIndexStore(null, null, null);
    }

    try {
      const context = await getIndexFileContext(source);
      return new FuzzyIndexStore(context.handle, context.directory, context.fileName);
    } catch (error) {
      console.warn('[fuzzy-index] Failed to initialise OPFS store', error);
      return new FuzzyIndexStore(null, null, null);
    }
  }

  async load(): Promise<FuzzyIndexSnapshot | null> {
    if (!this.handle) {
      return null;
    }

    try {
      const file = await this.handle.getFile();
      const text = await file.text();

      if (!text) {
        return null;
      }

      const parsed = JSON.parse(text) as unknown;
      return deserializeFuzzyIndexSnapshot(parsed);
    } catch (error) {
      console.warn('[fuzzy-index] Failed to load cached index', error);
      return null;
    }
  }

  async save(snapshot: FuzzyIndexSnapshot): Promise<void> {
    if (!this.handle) {
      return;
    }

    const payload = serializeFuzzyIndexSnapshot(snapshot);
    const json = JSON.stringify(payload);
    const bytes = textEncoder.encode(json);

    try {
      const writable = await this.handle.createWritable({ keepExistingData: false });
      await writable.write(bytes);
      await writable.close();

      if (import.meta.env.DEV) {
        logDebug('fuzzy-index', 'Persisted fuzzy index snapshot', {
          rowCount: snapshot.rowCount,
          tokenLimit: snapshot.tokenLimit,
          trigramSize: snapshot.trigramSize,
          columnCount: snapshot.columns.length,
          createdAt: snapshot.createdAt
        });
      }
    } catch (error) {
      console.warn('[fuzzy-index] Failed to persist snapshot', error);
    }
  }

  async clear(): Promise<void> {
    if (!this.handle) {
      return;
    }

    try {
      if (this.directory && this.fileName) {
        await this.directory.removeEntry(this.fileName);
        return;
      }

      const writable = await this.handle.createWritable({ keepExistingData: false });
      await writable.truncate(0);
      await writable.close();
    } catch (error) {
      console.warn('[fuzzy-index] Failed to clear snapshot', error);
    }
  }
}
