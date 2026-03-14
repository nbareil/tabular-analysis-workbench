type DebugPayload = Record<string, unknown>;

const DEBUG_STORAGE_KEY = 'tabularWorkbenchDebug';

declare global {
  interface Window {
    __TABULAR_WORKBENCH_DEBUG__?: boolean;
  }
}

const monotonicNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

const roundMilliseconds = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100) / 100;
};

const readInitialDebugLoggingEnabled = (): boolean => {
  if (typeof globalThis === 'undefined') {
    return false;
  }

  const globalDebugFlag = (
    globalThis as typeof globalThis & {
      __TABULAR_WORKBENCH_DEBUG__?: boolean;
    }
  ).__TABULAR_WORKBENCH_DEBUG__;
  if (typeof globalDebugFlag === 'boolean') {
    return globalDebugFlag;
  }

  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }

  try {
    const storedValue = window.localStorage.getItem(DEBUG_STORAGE_KEY);
    return storedValue === '1' || storedValue === 'true';
  } catch {
    return false;
  }
};

let debugLoggingEnabled = readInitialDebugLoggingEnabled();

export const isDebugLoggingEnabled = (): boolean => debugLoggingEnabled;

export const setDebugLoggingEnabled = (enabled: boolean): void => {
  debugLoggingEnabled = enabled;
};

export const logDebug = (
  scope: string,
  message: string,
  payload?: DebugPayload
): void => {
  if (
    !debugLoggingEnabled ||
    typeof console === 'undefined' ||
    typeof console.debug !== 'function'
  ) {
    return;
  }

  const wallClockIso = new Date().toISOString();
  const timestampMs = roundMilliseconds(monotonicNow());
  const prefix = `[${wallClockIso}][${scope}] ${message}`;

  if (payload && Object.keys(payload).length > 0) {
    console.debug(prefix, { ...payload, timestampMs, timestampIso: wallClockIso });
    return;
  }

  console.debug(prefix, { timestampMs, timestampIso: wallClockIso });
};
