export type CapabilityId =
  | 'file-system-access'
  | 'opfs'
  | 'streams'
  | 'compression'
  | 'workers';

export interface CapabilityDetail {
  id: CapabilityId;
  label: string;
  description: string;
  present: boolean;
  blocking: boolean;
}

export interface CapabilityReport {
  ok: boolean;
  checks: CapabilityDetail[];
  blocking: CapabilityDetail[];
  warnings: CapabilityDetail[];
}

const hasWindow = (): boolean => typeof window !== 'undefined';

const isTestEnv = (): boolean => {
  if (typeof import.meta === 'undefined') {
    return false;
  }
  try {
    return Boolean((import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'test');
  } catch {
    return false;
  }
};

export const detectCapabilities = (): CapabilityReport => {
  if (isTestEnv()) {
    return {
      ok: true,
      checks: [],
      blocking: [],
      warnings: []
    };
  }

  if (!hasWindow() || typeof navigator === 'undefined') {
    return {
      ok: true,
      checks: [],
      blocking: [],
      warnings: []
    };
  }

  const checks: CapabilityDetail[] = [
    {
      id: 'file-system-access',
      label: 'File System Access API',
      description: 'Requires Chromium 86+ for showOpenFilePicker.',
      present: typeof window.showOpenFilePicker === 'function',
      blocking: true
    },
    {
      id: 'streams',
      label: 'Streams API',
      description: 'ReadableStream, TransformStream, and TextDecoder must be available.',
      present:
        typeof ReadableStream !== 'undefined' &&
        typeof TransformStream !== 'undefined' &&
        typeof TextDecoder !== 'undefined',
      blocking: true
    },
    {
      id: 'compression',
      label: 'Compression Streams',
      description: 'DecompressionStream/CompressionStream required for .gz support.',
      present:
        typeof DecompressionStream === 'function' && typeof CompressionStream === 'function',
      blocking: true
    },
    {
      id: 'workers',
      label: 'Web Workers',
      description: 'Dedicated workers are required for parsing and query isolation.',
      present: typeof Worker === 'function',
      blocking: true
    },
    {
      id: 'opfs',
      label: 'Origin Private File System',
      description: 'Needed for session persistence, caching, and annotations.',
      present:
        typeof navigator.storage !== 'undefined' &&
        typeof navigator.storage.getDirectory === 'function',
      blocking: false
    }
  ];

  const blocking = checks.filter((check) => check.blocking && !check.present);
  const warnings = checks.filter((check) => !check.blocking && !check.present);

  return {
    ok: blocking.length === 0,
    checks,
    blocking,
    warnings
  };
};

export const supportsOpfs = (): boolean => {
  if (isTestEnv()) {
    return false;
  }

  if (!hasWindow() || typeof navigator === 'undefined') {
    return false;
  }

  return (
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  );
};
