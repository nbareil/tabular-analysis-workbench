const INDEX_DIRECTORY = 'row-index';
const INDEX_VERSION = 1;
const HEADER_WORDS = 5;

export interface RowIndexSummary {
  rowCount: number;
  bytesParsed: number;
}

export interface RowIndexEntry {
  rowIndex: number;
  byteOffset: number;
}

export interface RowIndexData {
  version: number;
  checkpointInterval: number;
  rowCount: number;
  entries: RowIndexEntry[];
  bytesParsed: number;
}

export interface RowIndexRecorder {
  record: (entry: RowIndexEntry) => void;
  finalize: (summary: RowIndexSummary) => Promise<void>;
  abort: () => Promise<void>;
}

export const findNearestCheckpoint = (
  entries: RowIndexEntry[],
  targetRow: number
): RowIndexEntry | null => {
  if (entries.length === 0) {
    return null;
  }

  let low = 0;
  let high = entries.length - 1;
  let candidate = entries[0]!;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const entry = entries[mid]!;

    if (entry.rowIndex === targetRow) {
      return entry;
    }

    if (entry.rowIndex < targetRow) {
      candidate = entry;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return candidate;
};

class NoopRowIndexStore implements RowIndexRecorder {
  record(): void {
    // no-op
  }

  async finalize(): Promise<void> {
    // no-op
  }

  async abort(): Promise<void> {
    // no-op
  }
}

const sanitizeFileName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'row_index';
};

const getIndexFileHandle = async (source: FileSystemFileHandle): Promise<FileSystemFileHandle> => {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(INDEX_DIRECTORY, { create: true });
  const fileName = `${sanitizeFileName(source.name)}.bin`;
  return dir.getFileHandle(fileName, { create: true });
};

const supportsOpfs = (): boolean => {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  );
};

export class RowIndexStore implements RowIndexRecorder {
  private readonly entries: number[] = [];
  private readonly checkpointInterval: number;
  private writableHandle: FileSystemFileHandle | null = null;

  private constructor(options: { checkpointInterval: number; handle: FileSystemFileHandle | null }) {
    this.checkpointInterval = options.checkpointInterval;
    this.writableHandle = options.handle;
  }

  static async create(
    source: FileSystemFileHandle,
    options: { checkpointInterval: number }
  ): Promise<RowIndexRecorder> {
    if (!supportsOpfs()) {
      return new NoopRowIndexStore();
    }

    try {
      const fileHandle = await getIndexFileHandle(source);

      return new RowIndexStore({
        checkpointInterval: options.checkpointInterval,
        handle: fileHandle
      });
    } catch (error) {
      console.warn('[row-index] Failed to initialize OPFS store', error);
      return new NoopRowIndexStore();
    }
  }

  static async load(source: FileSystemFileHandle): Promise<RowIndexData | null> {
    if (!supportsOpfs()) {
      return null;
    }

    try {
      const fileHandle = await getIndexFileHandle(source);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      const view = new Uint32Array(buffer);

      if (view.length < HEADER_WORDS) {
        return null;
      }

      const version = view[0];
      if (version !== INDEX_VERSION) {
        return null;
      }

      const checkpointInterval = view[1];
      const rowCount = view[2];
      const entryCount = view[3];
      const bytesParsed = view[4];

      const entries: RowIndexEntry[] = [];
      const expectedLength = HEADER_WORDS + entryCount * 2;
      if (view.length < expectedLength) {
        return null;
      }

      for (let offset = 0; offset < entryCount; offset += 1) {
        const base = HEADER_WORDS + offset * 2;
        entries.push({
          rowIndex: view[base],
          byteOffset: view[base + 1]
        });
      }

      return {
        version,
        checkpointInterval,
        rowCount,
        entries,
        bytesParsed
      };
    } catch (error) {
      console.warn('[row-index] Failed to load OPFS index', error);
      return null;
    }
  }

  record(entry: { rowIndex: number; byteOffset: number }): void {
    if (!this.writableHandle) {
      return;
    }

    const clampedRowIndex = Math.max(0, Math.min(entry.rowIndex, 0xffffffff));
    const clampedOffset = Math.max(0, Math.min(entry.byteOffset, 0xffffffff));

    this.entries.push(clampedRowIndex >>> 0, clampedOffset >>> 0);
  }

  async finalize(summary: RowIndexSummary): Promise<void> {
    if (!this.writableHandle) {
      return;
    }

    const entryCount = this.entries.length / 2;
    const totalWords = HEADER_WORDS + this.entries.length;
    const buffer = new ArrayBuffer(totalWords * Uint32Array.BYTES_PER_ELEMENT);
    const view = new Uint32Array(buffer);

    view[0] = INDEX_VERSION;
    view[1] = Math.max(0, Math.min(this.checkpointInterval, 0xffffffff)) >>> 0;
    view[2] = Math.max(0, Math.min(summary.rowCount, 0xffffffff)) >>> 0;
    view[3] = entryCount >>> 0;
    view[4] = Math.max(0, Math.min(summary.bytesParsed, 0xffffffff)) >>> 0;

    for (let index = 0; index < this.entries.length; index += 1) {
      view[HEADER_WORDS + index] = this.entries[index]!;
    }

    const writable = await this.writableHandle.createWritable({ keepExistingData: false });
    await writable.write(view);
    await writable.close();
  }

  async abort(): Promise<void> {
    if (!this.writableHandle) {
      return;
    }

    try {
      const writable = await this.writableHandle.createWritable({ keepExistingData: false });
      await writable.close();
    } catch (error) {
      console.warn('[row-index] Failed to abort OPFS write', error);
    }
  }
}
