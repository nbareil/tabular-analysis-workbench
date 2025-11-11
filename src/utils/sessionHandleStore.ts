const DB_NAME = 'csv-explorer-session';
const STORE_NAME = 'handles';
const DB_VERSION = 1;
export const ACTIVE_HANDLE_KEY = 'active-handle';

const hasIndexedDb = (): boolean => typeof indexedDB !== 'undefined';

const openDatabase = (): Promise<IDBDatabase | null> =>
  new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      resolve(null);
      return;
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Failed to open session handle store'));
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
    } catch (error) {
      reject(error);
    }
  });

const runRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });

export const persistActiveFileHandle = async (
  handle: FileSystemFileHandle | null
): Promise<string | null> => {
  const db = await openDatabase();
  if (!db) {
    return null;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  if (!handle) {
    await runRequest(store.delete(ACTIVE_HANDLE_KEY));
  } else {
    await runRequest(store.put(handle, ACTIVE_HANDLE_KEY));
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(null);
    tx.onerror = () => reject(tx.error ?? new Error('Failed to persist file handle'));
  });
  return handle ? ACTIVE_HANDLE_KEY : null;
};

export const loadActiveFileHandle = async (): Promise<FileSystemFileHandle | null> => {
  const db = await openDatabase();
  if (!db) {
    return null;
  }

  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const handle = await runRequest(store.get(ACTIVE_HANDLE_KEY));
  return handle ?? null;
};

export const clearActiveFileHandle = async (): Promise<void> => {
  const db = await openDatabase();
  if (!db) {
    return;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(ACTIVE_HANDLE_KEY);
  await new Promise((resolve) => {
    tx.oncomplete = () => resolve(null);
    tx.onerror = () => resolve(null);
  });
};
