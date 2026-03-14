import { useEffect, useRef } from 'react';

interface UseAutoFileLoaderOptions {
  workerReady: boolean;
  fileHandle: FileSystemFileHandle | null;
  loadFile: (handle: FileSystemFileHandle) => Promise<void>;
}

export const useAutoFileLoader = ({
  workerReady,
  fileHandle,
  loadFile
}: UseAutoFileLoaderOptions): void => {
  const lastRequestedHandleRef = useRef<FileSystemFileHandle | null>(null);

  useEffect(() => {
    if (!workerReady || !fileHandle) {
      return;
    }

    if (lastRequestedHandleRef.current === fileHandle) {
      if (import.meta.env.DEV) {
        console.info('[auto-file-loader] Skipping duplicate auto-load', {
          fileName: fileHandle.name ?? null
        });
      }
      return;
    }

    lastRequestedHandleRef.current = fileHandle;
    if (import.meta.env.DEV) {
      console.info('[auto-file-loader] Starting auto-load', {
        fileName: fileHandle.name ?? null
      });
    }

    void loadFile(fileHandle).catch(() => {
      if (import.meta.env.DEV) {
        console.warn('[auto-file-loader] Auto-load failed', {
          fileName: fileHandle.name ?? null
        });
      }
      if (lastRequestedHandleRef.current === fileHandle) {
        lastRequestedHandleRef.current = null;
      }
    });
  }, [fileHandle, loadFile, workerReady]);

  useEffect(() => {
    if (!fileHandle) {
      lastRequestedHandleRef.current = null;
    }
  }, [fileHandle]);
};
