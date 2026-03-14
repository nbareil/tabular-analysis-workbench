import { useCallback, useEffect, useRef, useState } from 'react';

import { useSessionStore, getSessionSnapshot, type SessionSnapshot } from '@state/sessionStore';
import { saveSessionSnapshot, loadSessionSnapshot } from '@utils/sessionPersistence';
import { AutoSaveScheduler } from '@utils/autoSaveScheduler';

export interface SessionPersistenceStatus {
  supported: boolean;
  restoring: boolean;
  reconnecting: boolean;
  canReconnect: boolean;
  reconnectFileName: string | null;
  lastSavedAt: number | null;
  error: string | null;
  reconnectFile: () => Promise<boolean>;
}

const AUTO_SAVE_INTERVAL_MS = 60_000;
const AUTO_SAVE_DEBOUNCE_MS = 5_000;

const requestReadPermission = async (
  handle: FileSystemFileHandle,
  options: { allowPrompt: boolean } = { allowPrompt: false }
): Promise<PermissionState | null> => {
  if (!handle || typeof handle.queryPermission !== 'function') {
    return null;
  }

  try {
    const current = await handle.queryPermission({ mode: 'read' });
    if (current === 'granted' || current === 'denied') {
      if (
        current === 'denied' &&
        options.allowPrompt &&
        typeof handle.requestPermission === 'function'
      ) {
        try {
          return await handle.requestPermission({ mode: 'read' });
        } catch (error) {
          console.warn('[session] requestPermission failed', error);
          return 'prompt';
        }
      }
      return current;
    }

    if (options.allowPrompt && typeof handle.requestPermission === 'function') {
      try {
        return await handle.requestPermission({ mode: 'read' });
      } catch (error) {
        console.warn('[session] requestPermission failed', error);
        return 'prompt';
      }
    }

    return current;
  } catch (error) {
    console.warn('[session] Failed to check file permission', error);
    return 'prompt';
  }
};

export const useSessionPersistence = (
  enabled: boolean
): SessionPersistenceStatus => {
  const [status, setStatus] = useState<SessionPersistenceStatus>({
    supported: enabled,
    restoring: enabled,
    reconnecting: false,
    canReconnect: false,
    reconnectFileName: null,
    lastSavedAt: null,
    error: null,
    reconnectFile: async () => false
  });
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const schedulerRef = useRef<AutoSaveScheduler | null>(null);
  const reconnectSnapshotRef = useRef<FileSystemFileHandle | null>(null);
  const reconnectSessionRef = useRef<SessionSnapshot | null>(null);
  const reconnectFileNameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus((previous) => ({
        supported: false,
        restoring: false,
        reconnecting: false,
        canReconnect: false,
        reconnectFileName: null,
        lastSavedAt: previous.lastSavedAt,
        error: previous.error,
        reconnectFile: previous.reconnectFile
      }));
      dirtyRef.current = false;
      reconnectSnapshotRef.current = null;
      reconnectSessionRef.current = null;
      reconnectFileNameRef.current = null;
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
        schedulerRef.current?.markDirty();
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
      ...previous,
      supported: true,
      lastSavedAt: result.updatedAt,
      error: null
    }));
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      return undefined;
    }

    const scheduler = new AutoSaveScheduler({
      debounceMs: AUTO_SAVE_DEBOUNCE_MS,
      maxIntervalMs: AUTO_SAVE_INTERVAL_MS,
      save: persistSnapshot
    });
    schedulerRef.current = scheduler;

    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [enabled, persistSnapshot]);

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
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const applySnapshot = (snapshot: NonNullable<typeof reconnectSessionRef.current>) => {
      useSessionStore.getState().hydrate(snapshot);
      reconnectSnapshotRef.current = null;
      reconnectSessionRef.current = null;
      reconnectFileNameRef.current = null;
      setStatus((previous) => ({
        ...previous,
        restoring: false,
        reconnecting: false,
        canReconnect: false,
        reconnectFileName: null,
        error: null
      }));
    };

    const setReconnectState = ({
      snapshot,
      fileName,
      error
    }: {
      snapshot: NonNullable<typeof reconnectSessionRef.current>;
      fileName: string | null;
      error: string;
    }) => {
      reconnectSessionRef.current = snapshot;
      reconnectSnapshotRef.current = snapshot.fileHandle;
      reconnectFileNameRef.current = fileName;
      setStatus((previous) => ({
        ...previous,
        restoring: false,
        reconnecting: false,
        canReconnect: Boolean(snapshot.fileHandle),
        reconnectFileName: fileName,
        error
      }));
    };

    const hydrate = async () => {
      setStatus((previous) => ({
        ...previous,
        restoring: true,
        reconnecting: false,
        canReconnect: false,
        reconnectFileName: null,
        error: null
      }));

      const loaded = await loadSessionSnapshot();
      if (!loaded || cancelled) {
        reconnectSnapshotRef.current = null;
        reconnectSessionRef.current = null;
        reconnectFileNameRef.current = null;
        setStatus((previous) => ({
          ...previous,
          restoring: false,
          reconnecting: false,
          canReconnect: false,
          reconnectFileName: null,
          error: null
        }));
        return;
      }

      const { snapshot, handleMissing, fileName } = loaded;

      if (handleMissing) {
        useSessionStore.getState().hydrate(snapshot);
        reconnectSnapshotRef.current = null;
        reconnectSessionRef.current = null;
        reconnectFileNameRef.current = null;
        const targetLabel = fileName ? `"${fileName}"` : 'the previous CSV';
        setStatus((previous) => ({
          ...previous,
          restoring: false,
          reconnecting: false,
          canReconnect: false,
          reconnectFileName: fileName,
          error: `Previous file permission for ${targetLabel} expired. Reopen it to continue.`
        }));
        return;
      }

      if (snapshot.fileHandle) {
        const permission = await requestReadPermission(snapshot.fileHandle, {
          allowPrompt: false
        });
        const resolvedFileName = fileName ?? snapshot.fileHandle.name ?? null;
        const reconnectTarget = resolvedFileName ? `"${resolvedFileName}"` : 'the previous file';
        if (permission === 'denied') {
          setReconnectState({
            snapshot,
            fileName: resolvedFileName,
            error: `File access for ${reconnectTarget} needs permission again. Click reconnect or reopen it.`
          });
          return;
        }

        if (permission !== 'granted') {
          setReconnectState({
            snapshot,
            fileName: resolvedFileName,
            error: `Reconnect ${reconnectTarget} to continue.`
          });
          return;
        }
      }

      applySnapshot(snapshot);
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const reconnectFile = useCallback(async (): Promise<boolean> => {
    const snapshot = reconnectSessionRef.current;
    const handle = reconnectSnapshotRef.current;
    if (!snapshot || !handle) {
      return false;
    }

    setStatus((previous) => ({
      ...previous,
      reconnecting: true,
      error: null
    }));

    const permission = await requestReadPermission(handle, { allowPrompt: true });
    if (permission !== 'granted') {
      const reconnectTarget = reconnectFileNameRef.current
        ? `"${reconnectFileNameRef.current}"`
        : 'the previous file';
      setStatus((previous) => ({
        ...previous,
        reconnecting: false,
        canReconnect: true,
        error: `Unable to re-establish permission for ${reconnectTarget}. Please reopen it.`
      }));
      return false;
    }

    useSessionStore.getState().hydrate(snapshot);
    reconnectSnapshotRef.current = null;
    reconnectSessionRef.current = null;
    reconnectFileNameRef.current = null;
    setStatus((previous) => ({
      ...previous,
      restoring: false,
      reconnecting: false,
      canReconnect: false,
      reconnectFileName: null,
      error: null
    }));
    return true;
  }, []);

  return {
    ...status,
    reconnectFile
  };
};
