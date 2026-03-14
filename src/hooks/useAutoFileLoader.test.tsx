import { StrictMode, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAutoFileLoader } from './useAutoFileLoader';

const strictModeWrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>{children}</StrictMode>
);

describe('useAutoFileLoader', () => {
  it('loads a restored file handle only once under StrictMode', async () => {
    const handle = { name: 'events.csv' } as FileSystemFileHandle;
    const loadFile = vi.fn<[(typeof handle)], Promise<void>>().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ workerReady, fileHandle }: { workerReady: boolean; fileHandle: FileSystemFileHandle | null }) =>
        useAutoFileLoader({
          workerReady,
          fileHandle,
          loadFile
        }),
      {
        initialProps: {
          workerReady: false,
          fileHandle: handle
        },
        wrapper: strictModeWrapper
      }
    );

    expect(loadFile).not.toHaveBeenCalled();

    rerender({
      workerReady: true,
      fileHandle: handle
    });

    await waitFor(() => {
      expect(loadFile).toHaveBeenCalledTimes(1);
    });
  });
});
