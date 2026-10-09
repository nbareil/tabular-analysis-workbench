import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearStoredData } from './clearStoredData';

vi.mock('./capabilities', () => ({
  supportsOpfs: () => true
}));

describe('clearStoredData', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('removes workbench localStorage keys and every OPFS entry', async () => {
    window.localStorage.setItem('wlx:theme', 'dark');
    window.localStorage.setItem('other-app', 'kept');
    const removed: string[] = [];
    const root = {
      async *keys() {
        yield 'row-cache';
        yield 'annotations';
      },
      removeEntry: vi.fn(async (name: string) => {
        removed.push(name);
      })
    };
    vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn().mockResolvedValue(root) } });

    await clearStoredData();

    expect(window.localStorage.getItem('wlx:theme')).toBeNull();
    expect(window.localStorage.getItem('other-app')).toBe('kept');
    expect(removed).toEqual(['row-cache', 'annotations']);
  });
});
