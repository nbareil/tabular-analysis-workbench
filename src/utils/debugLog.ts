type DebugPayload = Record<string, unknown>;

const monotonicNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

const roundMilliseconds = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100) / 100;
};

export const logDebug = (
  scope: string,
  message: string,
  payload?: DebugPayload
): void => {
  if (typeof console === 'undefined' || typeof console.debug !== 'function') {
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
