import '@testing-library/jest-dom/vitest';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';

// Ensure worker-style globals exist so parser/type inference specs run consistently under Vitest.
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = NodeTextEncoder as typeof globalThis.TextEncoder;
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = NodeTextDecoder as typeof globalThis.TextDecoder;
}

if (typeof globalThis.ReadableStream === 'undefined') {
  globalThis.ReadableStream = NodeReadableStream as typeof globalThis.ReadableStream;
}

if (typeof globalThis.navigator === 'undefined') {
  (globalThis as any).navigator = { userAgent: 'vitest', storage: undefined };
} else if (!('storage' in globalThis.navigator)) {
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: undefined,
    configurable: true,
    writable: true
  });
}
