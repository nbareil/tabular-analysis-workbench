import { useCallback, useEffect, useRef, useState } from 'react';

import { useSessionStore, getSessionSnapshot } from '@state/sessionStore';
import { saveSessionSnapshot, loadSessionSnapshot } from '@utils/sessionPersistence';

export interface SessionPersistenceStatus {
  supported: boolean;
  restoring: boolean;
  lastSavedAt: number | null;
  error: string | null;
}

const AUTO_SAVE_INTERVAL_MS = 60_000;

const requestReadPermission = async (
  handle: FileSystemFileHandle
): Promise<PermissionState | null> => {
  if (!handle || typeof handle.queryPermission !== 'function') {
    return null;
  }

  const current = await handle.queryPermission({ mode: 'read' });
  if (current === 'granted' || current === 'denied') {
    return current;
  }

  if (typeof handle.requestPermission === 'function') {
    return handle.requestPermission({ mode: 'read' });
  }

  return current;
};

export const useSessionPersistence = (
  enabled: boolean
): SessionPersistenceStatus => {
  const [status, setStatus] = useState<SessionPersistenceStatus>({
    supported: enabled,
    restoring: enabled,
    lastSavedAt: null,
    error: null
  });
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setStatus((previous) => ({
        supported: false,
        restoring: false,
        lastSavedAt: previous.lastSavedAt,
        error: previous.error
      }));
      dirtyRef.current = false;
      return;
    }

    setStatus((previous) => ({
      ...previous,
      supported: true
    }));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const unsubscribe = useSessionStore.subscribe((state, previous) => {
      if (state.updatedAt !== previous.updatedAt) {
        dirtyRef.current = true;
      }
    });

    return unsubscribe;
  }, [enabled]);

  const persistSnapshot = useCallback(async () => {
    if (!dirtyRef.current || savingRef.current || !enabled) {
      return;
    }

    savingRef.current = true;
    const snapshot = getSessionSnapshot();

    const result = await saveSessionSnapshot(snapshot);
    savingRef.current = false;

    if (!result) {
      setStatus((previous) => ({
        ...previous,
        error: 'Failed to persist session; will retry automatically.'
      }));
      return;
    }

    dirtyRef.current = false;
    setStatus((previous) => ({
      supported: true,
      restoring: previous.restoring,
      lastSavedAt: result.updatedAt,
      error: null
    }));
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return undefined;
    }

    const handle = () => {
      if (dirtyRef.current) {
        void persistSnapshot();
      }
    };
    window.addEventListener('beforeunload', handle);
    return () => {
      window.removeEventListener('beforeunload', handle);
    };
  }, [enabled, persistSnapshot]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void persistSnapshot();
    }, AUTO_SAVE_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [enabled, persistSnapshot]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const hydrate = async () => {
      setStatus((previous) => ({
        ...previous,
        restoring: true
      }));

      const loaded = await loadSessionSnapshot();
      if (!loaded || cancelled) {
        setStatus((previous) => ({
          ...previous,
          restoring: false
        }));
        return;
      }

      const { snapshot, handleMissing } = loaded;

      if (handleMissing) {
        useSessionStore.getState().hydrate(snapshot);
        setStatus((previous) => ({
          ...previous,
          restoring: false,
          error: 'Previous file permission expired. Reopen the CSV to continue.'
        }));
        return;
      }

      if (snapshot.fileHandle) {
        const permission = await requestReadPermission(snapshot.fileHandle);
        if (permission === 'denied') {
          setStatus((previous) => ({
            ...previous,
            restoring: false,
            error: 'File access revoked. Reopen the CSV to continue.'
          }));
          return;
        }

        if (permission !== 'granted') {
          setStatus((previous) => ({
            ...previous,
            restoring: false,
            error: 'Unable to re-establish file permission. Please reopen the file.'
          }));
          return;
        }
      }

      useSessionStore.getState().hydrate(snapshot);
      setStatus((previous) => ({
        ...previous,
        restoring: false,
        error: null
      }));
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return status;
};
