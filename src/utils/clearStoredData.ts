import { THEME_STORAGE_KEY } from '@state/appStore';
import { supportsOpfs } from './capabilities';
import { DEBUG_STORAGE_KEY, setDebugLoggingEnabled } from './debugLog';
import { SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY } from './persistenceRetention';
import { markStoredDataFlushInProgress } from './persistenceReset';
import { clearActiveFileHandle } from './sessionHandleStore';

const OPFS_DIRECTORIES = ['sessions', 'row-cache', 'row-index', 'annotations'] as const;
const LOCAL_STORAGE_KEYS = [
  THEME_STORAGE_KEY,
  DEBUG_STORAGE_KEY,
  SESSION_RETENTION_LAST_ACTIVE_BY_FILE_STORAGE_KEY
] as const;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface ClearPersistedWorkbenchDataOptions {
  clearLocalStorage?: boolean;
  markFlushInProgress?: boolean;
}

interface ClearPersistedFileDataOptions {
  clearSessionSnapshots?: boolean;
}

const clearLocalStorageKeys = (): void => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  for (const key of LOCAL_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      throw new Error(`Failed to clear local storage key "${key}": ${toErrorMessage(error)}`);
    }
  }
};

const clearOpfsDirectories = async (): Promise<void> => {
  if (!supportsOpfs()) {
    return;
  }

  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch (error) {
    throw new Error(`Failed to access browser storage: ${toErrorMessage(error)}`);
  }

  for (const directoryName of OPFS_DIRECTORIES) {
    try {
      await root.getDirectoryHandle(directoryName);
    } catch {
      continue;
    }

    try {
      await root.removeEntry(directoryName, { recursive: true });
    } catch (error) {
      throw new Error(
        `Failed to clear stored "${directoryName}" data: ${toErrorMessage(error)}`
      );
    }
  }
};

const removeOpfsEntryIfPresent = async (
  root: FileSystemDirectoryHandle,
  directoryName: string,
  entryName: string,
  options?: FileSystemRemoveOptions
): Promise<void> => {
  let directory: FileSystemDirectoryHandle;
  try {
    directory = await root.getDirectoryHandle(directoryName);
  } catch {
    return;
  }

  try {
    await directory.removeEntry(entryName, options);
  } catch {
    // ignore missing or already removed entries
  }
};

export const clearPersistedFileData = async (
  storageKey: string,
  options: ClearPersistedFileDataOptions = {}
): Promise<void> => {
  if (!supportsOpfs()) {
    if (options.clearSessionSnapshots) {
      await clearActiveFileHandle();
    }
    return;
  }

  const root = await navigator.storage.getDirectory();
  await removeOpfsEntryIfPresent(root, 'annotations', `tags-${storageKey}.json`);
  await removeOpfsEntryIfPresent(root, 'annotations', `tags-${storageKey}.tmp.json`);
  await removeOpfsEntryIfPresent(root, 'row-cache', storageKey, { recursive: true });
  await removeOpfsEntryIfPresent(root, 'row-index', `${storageKey}.bin`);

  if (!options.clearSessionSnapshots) {
    return;
  }

  try {
    await root.removeEntry('sessions', { recursive: true });
  } catch {
    // ignore
  }
  await clearActiveFileHandle();
};

export const clearPersistedWorkbenchData = async (
  options: ClearPersistedWorkbenchDataOptions = {}
): Promise<void> => {
  const { clearLocalStorage = true, markFlushInProgress = false } = options;

  if (markFlushInProgress) {
    markStoredDataFlushInProgress();
  }

  if (clearLocalStorage) {
    setDebugLoggingEnabled(false);
    clearLocalStorageKeys();
  }

  try {
    await clearActiveFileHandle();
  } catch (error) {
    throw new Error(`Failed to clear saved file handles: ${toErrorMessage(error)}`);
  }

  await clearOpfsDirectories();
};

export const clearStoredData = async (): Promise<void> =>
  clearPersistedWorkbenchData({
    clearLocalStorage: true,
    markFlushInProgress: true
  });
