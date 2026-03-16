import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveBlobFile, saveJsonFile } from './fileAccess';

describe('saveBlobFile', () => {
  afterEach(() => {
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    vi.restoreAllMocks();
  });

  it('normalizes MIME parameters before calling showSaveFilePicker', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable });

    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      writable: true,
      value: showSaveFilePicker
    });

    const blob = new Blob(['a,b\n1,2'], { type: 'text/csv;charset=utf-8;' });

    await saveBlobFile({
      suggestedName: 'export.csv',
      blob,
      description: 'CSV export',
      mimeType: blob.type,
      extensions: ['.csv']
    });

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'export.csv',
      types: [
        {
          description: 'CSV export',
          accept: {
            'text/csv': ['.csv']
          }
        }
      ]
    });
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('saveJsonFile', () => {
  afterEach(() => {
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    vi.restoreAllMocks();
  });

  it('uses an accept type that the save picker accepts for JSON exports', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable });

    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      writable: true,
      value: showSaveFilePicker
    });

    await saveJsonFile({
      suggestedName: 'diagnostics.json',
      contents: '{"ok":true}'
    });

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'diagnostics.json',
      types: [
        {
          description: 'JSON file',
          accept: {
            'application/json': ['.json']
          }
        }
      ]
    });
    const writtenBlob = write.mock.calls[0]?.[0];
    expect(writtenBlob).toBeInstanceOf(Blob);
    expect(writtenBlob.type).toBe('application/json;charset=utf-8;');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
