import { supportsOpfs } from './capabilities';

const DEFAULT_BUDGET_BYTES = 200 * 1024 * 1024; // ~200 MB
const DEFAULT_DIRECTORIES = ['row-cache', 'fuzzy-index', 'row-index', 'annotations', 'sessions'];

type DirectoryIterator = AsyncIterableIterator<[string, FileSystemHandle]>;

interface DirectoryWithEntries extends FileSystemDirectoryHandle {
  entries?: () => DirectoryIterator;
}

export interface OpfsEntry {
  directory: string;
  name: string;
  size: number;
  lastModified: number;
  handle: FileSystemFileHandle;
  directoryHandle: FileSystemDirectoryHandle;
}

export interface EnforceOpfsBudgetOptions {
  maxBytes?: number;
  directories?: string[];
  root?: FileSystemDirectoryHandle;
  preserve?: (entry: OpfsEntry) => boolean;
}

const iterateDirectoryEntries = async function* (
  directory: FileSystemDirectoryHandle
): AsyncGenerator<[string, FileSystemHandle], void, void> {
  const entries = (directory as DirectoryWithEntries).entries;
  if (!entries) {
    return;
  }

  for await (const entry of entries.call(directory) as DirectoryIterator) {
    yield entry;
  }
};

const collectEntries = async (
  root: FileSystemDirectoryHandle,
  directories: string[]
): Promise<OpfsEntry[]> => {
  const entries: OpfsEntry[] = [];

  for (const directoryName of directories) {
    let directoryHandle: FileSystemDirectoryHandle;
    try {
      directoryHandle = await root.getDirectoryHandle(directoryName);
    } catch {
      continue;
    }

    for await (const [name, handle] of iterateDirectoryEntries(directoryHandle)) {
      if (!name || typeof name !== 'string') {
        continue;
      }

      if (!handle || typeof (handle as FileSystemFileHandle).getFile !== 'function') {
        continue;
      }

      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        entries.push({
          directory: directoryName,
          name,
          size: typeof file.size === 'number' ? file.size : 0,
          lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0,
          handle: handle as FileSystemFileHandle,
          directoryHandle
        });
      } catch {
        // Ignore unreadable entries.
      }
    }
  }

  return entries;
};

export const enforceOpfsBudget = async (
  options: EnforceOpfsBudgetOptions = {}
): Promise<{ totalBytes: number; removed: Array<{ directory: string; name: string }> }> => {
  const maxBytes = options.maxBytes ?? DEFAULT_BUDGET_BYTES;
  const directories = options.directories ?? DEFAULT_DIRECTORIES;

  if (!options.root && !supportsOpfs()) {
    return { totalBytes: 0, removed: [] };
  }

  let root: FileSystemDirectoryHandle;
  try {
    root = options.root ?? (await navigator.storage.getDirectory());
  } catch {
    return { totalBytes: 0, removed: [] };
  }

  const entries = await collectEntries(root, directories);
  const totalBytes = entries.reduce((acc, entry) => acc + entry.size, 0);

  if (totalBytes <= maxBytes) {
    return { totalBytes, removed: [] };
  }

  const directoryPriority = new Map<string, number>();
  directories.forEach((name, index) => directoryPriority.set(name, index));

  const candidates = entries
    .filter((entry) => !(options.preserve?.(entry) ?? false))
    .sort((a, b) => {
      const priorityDiff =
        (directoryPriority.get(a.directory) ?? directories.length) -
        (directoryPriority.get(b.directory) ?? directories.length);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      if (a.lastModified !== b.lastModified) {
        return a.lastModified - b.lastModified;
      }

      return a.size - b.size;
    });

  let bytesRemaining = totalBytes;
  const removed: Array<{ directory: string; name: string }> = [];

  for (const entry of candidates) {
    if (bytesRemaining <= maxBytes) {
      break;
    }

    try {
      await entry.directoryHandle.removeEntry(entry.name);
      bytesRemaining -= entry.size;
      removed.push({ directory: entry.directory, name: entry.name });
    } catch (error) {
      console.warn('[opfs-quota] Failed to remove entry', entry.directory, entry.name, error);
    }
  }

  return { totalBytes: bytesRemaining, removed };
};
