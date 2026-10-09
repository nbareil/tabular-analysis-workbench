import { supportsOpfs } from './capabilities';

/** Prefix shared by every localStorage key the workbench writes. */
export const STORAGE_KEY_PREFIX = 'wlx:';

/**
 * Deletes everything the workbench stored in this browser: all OPFS entries (row cache and
 * annotations) and every `wlx:` localStorage key. Callers reload the page afterwards.
 */
export const clearStoredData = async (): Promise<void> => {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(STORAGE_KEY_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }

  if (!supportsOpfs()) {
    return;
  }
  const root = await navigator.storage.getDirectory();
  const names: string[] = [];
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    names.push(name);
  }
  for (const name of names) {
    await root.removeEntry(name, { recursive: true });
  }
};
