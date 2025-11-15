import type { SessionSnapshot } from '@state/sessionStore';
import { supportsOpfs } from './capabilities';
import { enforceOpfsBudget } from './opfsQuotaManager';
import {
  ACTIVE_HANDLE_KEY,
  clearActiveFileHandle,
  loadActiveFileHandle,
  persistActiveFileHandle
} from './sessionHandleStore';

const SESSION_DIRECTORY = 'sessions';
const SESSION_FILE = 'latest.json';
const HISTORY_PREFIX = 'snapshot-';
const MAX_HISTORY_FILES = 3;
const SESSION_VERSION = 1;

const textEncoder = new TextEncoder();

type DirectoryIterator = AsyncIterableIterator<[string, FileSystemHandle]>;
type DirectoryWithEntries = FileSystemDirectoryHandle & {
  entries?: () => DirectoryIterator;
};

type PersistableSnapshot = Omit<SessionSnapshot, 'fileHandle'>;

interface SessionEnvelope {
  version: number;
  updatedAt: number;
  handleKey: string | null;
  snapshot: PersistableSnapshot;
}

const getSessionDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (!supportsOpfs()) {
    return null;
  }

  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(SESSION_DIRECTORY, { create: true });
  } catch (error) {
    console.warn('[session] Failed to open OPFS session directory', error);
    return null;
  }
};

const writeJsonFile = async (
  directory: FileSystemDirectoryHandle,
  fileName: string,
  payload: unknown
): Promise<void> => {
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  const data = textEncoder.encode(JSON.stringify(payload));

  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
};

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

const pruneHistory = async (directory: FileSystemDirectoryHandle): Promise<void> => {
  const historyEntries: { name: string; handle: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of iterateDirectoryEntries(directory)) {
    if (typeof name === 'string' && name.startsWith(HISTORY_PREFIX)) {
      historyEntries.push({
        name,
        handle: handle as FileSystemFileHandle
      });
    }
  }

  if (historyEntries.length <= MAX_HISTORY_FILES) {
    return;
  }

  const sorted = historyEntries.sort((a, b) => a.name.localeCompare(b.name));
  const excess = sorted.slice(0, Math.max(0, sorted.length - MAX_HISTORY_FILES));
  await Promise.allSettled(
    excess.map(async (entry) => {
      try {
        await directory.removeEntry(entry.name);
      } catch (error) {
        console.warn('[session] Failed to remove old snapshot', entry.name, error);
      }
    })
  );
};

const toPersistableSnapshot = (snapshot: SessionSnapshot): PersistableSnapshot => {
  const { fileHandle: _ignore, ...rest } = snapshot;
  return rest;
};

export const saveSessionSnapshot = async (
  snapshot: SessionSnapshot
): Promise<{ updatedAt: number } | null> => {
  const directory = await getSessionDirectory();
  if (!directory) {
    return null;
  }

  try {
    const handleKey = await persistActiveFileHandle(snapshot.fileHandle);

    // Rotate previous latest into history if it exists.
    try {
      const latestHandle = await directory.getFileHandle(SESSION_FILE);
      const historyName = `${HISTORY_PREFIX}${Date.now()}.json`;
      const file = await latestHandle.getFile();
      if (file.size > 0) {
        await writeJsonFile(directory, historyName, JSON.parse(await file.text()));
      }
      await pruneHistory(directory);
    } catch {
      // No previous snapshot — nothing to rotate.
    }

    const envelope: SessionEnvelope = {
      version: SESSION_VERSION,
      updatedAt: Date.now(),
      handleKey: handleKey,
      snapshot: toPersistableSnapshot(snapshot)
    };

    await writeJsonFile(directory, SESSION_FILE, envelope);
    await enforceOpfsBudget({
      preserve: (entry) => entry.directory === SESSION_DIRECTORY && entry.name === SESSION_FILE
    });
    return { updatedAt: envelope.updatedAt };
  } catch (error) {
    console.warn('[session] Failed to persist snapshot', error);
    return null;
  }
};

export interface LoadedSessionSnapshot {
  snapshot: SessionSnapshot;
  handleMissing: boolean;
}

export const loadSessionSnapshot = async (): Promise<LoadedSessionSnapshot | null> => {
  const directory = await getSessionDirectory();
  if (!directory) {
    return null;
  }

  try {
    const handle = await directory.getFileHandle(SESSION_FILE);
    const file = await handle.getFile();
    if (file.size === 0) {
      return null;
    }

    const json = await file.text();
    const envelope = JSON.parse(json) as SessionEnvelope;
    if (!envelope || envelope.version !== SESSION_VERSION) {
      return null;
    }

    await enforceOpfsBudget({
      preserve: (entry) => entry.directory === SESSION_DIRECTORY && entry.name === SESSION_FILE
    });

    const activeHandle = envelope.handleKey ? await loadActiveFileHandle() : null;
    return {
      snapshot: {
        ...envelope.snapshot,
        fileHandle: activeHandle ?? null
      },
      handleMissing: Boolean(envelope.handleKey) && !activeHandle
    };
  } catch (error) {
    console.warn('[session] Failed to load snapshot', error);
    return null;
  }
};

export const clearSessionSnapshots = async (): Promise<void> => {
  const directory = await getSessionDirectory();
  if (!directory) {
    return;
  }

  try {
    await directory.removeEntry(SESSION_FILE);
  } catch {
    // ignore
  }
  for await (const [name] of iterateDirectoryEntries(directory)) {
    if (typeof name === 'string' && name.startsWith(HISTORY_PREFIX)) {
      try {
        await directory.removeEntry(name);
      } catch {
        // ignore
      }
    }
  }
  await clearActiveFileHandle();
};
