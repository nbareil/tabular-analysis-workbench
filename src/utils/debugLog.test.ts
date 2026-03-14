import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('debugLog', () => {
  const originalDebugFlag = (
    globalThis as typeof globalThis & {
      __TABULAR_WORKBENCH_DEBUG__?: boolean;
    }
  ).__TABULAR_WORKBENCH_DEBUG__;

  beforeEach(() => {
    vi.resetModules();
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      window.localStorage.removeItem('tabularWorkbenchDebug');
    }
    delete (
      globalThis as typeof globalThis & {
        __TABULAR_WORKBENCH_DEBUG__?: boolean;
      }
    ).__TABULAR_WORKBENCH_DEBUG__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      window.localStorage.removeItem('tabularWorkbenchDebug');
    }

    if (typeof originalDebugFlag === 'boolean') {
      (
        globalThis as typeof globalThis & {
          __TABULAR_WORKBENCH_DEBUG__?: boolean;
        }
      ).__TABULAR_WORKBENCH_DEBUG__ = originalDebugFlag;
      return;
    }

    delete (
      globalThis as typeof globalThis & {
        __TABULAR_WORKBENCH_DEBUG__?: boolean;
      }
    ).__TABULAR_WORKBENCH_DEBUG__;
  });

  it('is disabled by default', async () => {
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const { isDebugLoggingEnabled, logDebug } = await import('./debugLog');

    expect(isDebugLoggingEnabled()).toBe(false);

    logDebug('test', 'should not log', { foo: 'bar' });

    expect(consoleDebug).not.toHaveBeenCalled();
  });

  it('can be enabled explicitly at runtime', async () => {
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const { isDebugLoggingEnabled, logDebug, setDebugLoggingEnabled } = await import('./debugLog');

    setDebugLoggingEnabled(true);

    expect(isDebugLoggingEnabled()).toBe(true);

    logDebug('test', 'should log', { foo: 'bar' });

    expect(consoleDebug).toHaveBeenCalledTimes(1);
  });

  it('can be enabled from persisted local storage state', async () => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }

    window.localStorage.setItem('tabularWorkbenchDebug', '1');

    const { isDebugLoggingEnabled } = await import('./debugLog');

    expect(isDebugLoggingEnabled()).toBe(true);
  });
});
