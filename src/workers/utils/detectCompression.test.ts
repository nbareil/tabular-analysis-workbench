// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { isGzip } from './detectCompression';

describe('isGzip', () => {
  it('detects gzip by magic bytes regardless of name or MIME type', async () => {
    const file = new File([new Uint8Array([0x1f, 0x8b, 0x08, 0x00])], 'data.csv', { type: 'text/csv' });
    await expect(isGzip(file)).resolves.toBe(true);
  });

  it('rejects files named .gz that are not gzip', async () => {
    const file = new File(['a,b\n1,2\n'], 'data.csv.gz', { type: 'application/gzip' });
    await expect(isGzip(file)).resolves.toBe(false);
  });

  it('handles empty and one-byte files', async () => {
    await expect(isGzip(new Blob([]))).resolves.toBe(false);
    await expect(isGzip(new Blob([new Uint8Array([0x1f])]))).resolves.toBe(false);
  });
});
