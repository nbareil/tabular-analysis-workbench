import { describe, it, expect } from 'vitest';

import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('returns 0 B for zero or negative values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
  });

  it('handles byte values under 1 KB without decimals', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes and gigabytes appropriately', () => {
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2 GB');
  });

  it('caps the unit at GB for extremely large values', () => {
    expect(formatBytes(1024 ** 4)).toBe('1024.0 GB');
  });
});
