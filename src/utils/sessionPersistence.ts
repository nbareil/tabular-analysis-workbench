import type { SessionSnapshot } from '@state/sessionStore';
import { supportsOpfs } from './capabilities';
import { clearPersistedFileData } from './clearStoredData';
import { enforceOpfsBudget } from './opfsQuotaManager';
import {
  SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY,
  SESSION_RETENTION_MS
} from './persistenceRetention';
import {
  ACTIVE_HANDLE_KEY,
  clearActiveFileHandle,
  loadActiveFileHandle,
  persistActiveFileHandle
} from './sessionHandleStore';
import { buildDatasetStorageKey, createDatasetFingerprint } from '@workers/datasetFingerprint';

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
  fileName: string | null;
  storageKey: string | null;
  snapshot: PersistableSnapshot;
}

const readLastActiveByFile = (): Record<string, number> => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return {};
  }

  const rawValue = window.localStorage.getItem(SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    );
  } catch {
    return {};
  }
};

const writeLastActiveByFile = (value: Record<string, number>): void => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY,
    JSON.stringify(value)
  );
};

const touchLastActiveAt = (storageKey: string | null): void => {
  if (!storageKey) {
    return;
  }

  writeLastActiveByFile({
    ...readLastActiveByFile(),
    [storageKey]: Date.now()
  });
};

const removeLastActiveAt = (storageKey: string | null): void => {
  if (!storageKey) {
    return;
  }

  const next = readLastActiveByFile();
  delete next[storageKey];
  writeLastActiveByFile(next);
};

const resolveSessionStorageKey = async (
  fileHandle: FileSystemFileHandle | null
): Promise<string | null> => {
  if (!fileHandle) {
    return null;
  }

  const file = await fileHandle.getFile();
  return buildDatasetStorageKey(createDatasetFingerprint(file, fileHandle));
};

const pruneExpiredPersistedData = async (
  activeStorageKey: string | null
): Promise<{ activeStorageKeyExpired: boolean }> => {
  const entries = Object.entries(readLastActiveByFile());
  if (entries.length === 0) {
    return { activeStorageKeyExpired: false };
  }

  const now = Date.now();
  let activeStorageKeyExpired = false;

  for (const [storageKey, lastActiveAt] of entries) {
    if (now - lastActiveAt <= SESSION_RETENTION_MS) {
      continue;
    }

    await clearPersistedFileData(storageKey, {
      clearSessionSnapshots: storageKey === activeStorageKey
    });
    removeLastActiveAt(storageKey);
    if (storageKey === activeStorageKey) {
      activeStorageKeyExpired = true;
    }
  }

  return { activeStorageKeyExpired };
};

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
    const storageKey = await resolveSessionStorageKey(snapshot.fileHandle);

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
      fileName: snapshot.fileHandle?.name ?? null,
      storageKey,
      snapshot: toPersistableSnapshot(snapshot)
    };

    await writeJsonFile(directory, SESSION_FILE, envelope);
    await enforceOpfsBudget({
      preserve: (entry) => entry.directory === SESSION_DIRECTORY && entry.name === SESSION_FILE
    });
    touchLastActiveAt(storageKey);
    return { updatedAt: envelope.updatedAt };
  } catch (error) {
    console.warn('[session] Failed to persist snapshot', error);
    return null;
  }
};

export interface LoadedSessionSnapshot {
  snapshot: SessionSnapshot;
  handleMissing: boolean;
  fileName: string | null;
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

    const { activeStorageKeyExpired } = await pruneExpiredPersistedData(envelope.storageKey ?? null);
    if (activeStorageKeyExpired) {
      return null;
    }

    await enforceOpfsBudget({
      preserve: (entry) => entry.directory === SESSION_DIRECTORY && entry.name === SESSION_FILE
    });

    const activeHandle = envelope.handleKey ? await loadActiveFileHandle() : null;
    const storageKey =
      envelope.storageKey ??
      (activeHandle ? await resolveSessionStorageKey(activeHandle) : null);
    touchLastActiveAt(storageKey);
    return {
      snapshot: {
        ...envelope.snapshot,
        fileHandle: activeHandle ?? null
      },
      handleMissing: Boolean(envelope.handleKey) && !activeHandle,
      fileName: envelope.fileName ?? activeHandle?.name ?? null
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
