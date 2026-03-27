import { THEME_STORAGE_KEY } from '@state/appStore';
import { supportsOpfs } from './capabilities';
import { DEBUG_STORAGE_KEY, setDebugLoggingEnabled } from './debugLog';
import { markStoredDataFlushInProgress } from './persistenceReset';
import { clearActiveFileHandle } from './sessionHandleStore';

const OPFS_DIRECTORIES = ['sessions', 'row-cache', 'row-index', 'annotations'] as const;
const LOCAL_STORAGE_KEYS = [THEME_STORAGE_KEY, DEBUG_STORAGE_KEY] as const;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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

export const clearStoredData = async (): Promise<void> => {
  markStoredDataFlushInProgress();
  setDebugLoggingEnabled(false);

  clearLocalStorageKeys();

  try {
    await clearActiveFileHandle();
  } catch (error) {
    throw new Error(`Failed to clear saved file handles: ${toErrorMessage(error)}`);
  }

  await clearOpfsDirectories();
};
