import { describe, expect, it } from 'vitest';

import { createDataWorkerApi } from './dataWorker.worker';
import type { LoadCompleteSummary } from './workerApiTypes';
import type { FuzzyIndexSnapshot, FuzzyIndexFingerprint } from './fuzzyIndexStore';
import { FUZZY_INDEX_STORE_VERSION } from './fuzzyIndexStore';
import type { FilterNode } from './types';
import { createFuzzyFingerprint, fuzzySnapshotMatchesFingerprint } from './fuzzyIndexUtils';
import { createMockFileHandle } from './test/mockFileHandle';

describe('createFuzzyFingerprint', () => {
  it('derives fingerprint metadata from file properties', () => {
    const file = {
      name: 'events.csv',
      size: 1024,
      lastModified: 987654321
    } as unknown as File;

    const handle = {
      name: 'fallback.csv'
    } as FileSystemFileHandle;

    const fingerprint = createFuzzyFingerprint(file, handle);

    expect(fingerprint).toEqual({
      fileName: 'events.csv',
      fileSize: 1024,
      lastModified: 987654321
    });
  });

  it('falls back to handle metadata when file lacks properties', () => {
    const file = {
      size: undefined,
      name: undefined,
      lastModified: undefined
    } as unknown as File;

    const handle = {
      name: 'session.tsv'
    } as FileSystemFileHandle;

    const fingerprint = createFuzzyFingerprint(file, handle);
    expect(fingerprint.fileName).toBe('session.tsv');
    expect(fingerprint.fileSize).toBe(0);
    expect(fingerprint.lastModified).toBe(0);
  });
});

describe('fuzzySnapshotMatchesFingerprint', () => {
  const buildSnapshot = (fingerprint: FuzzyIndexFingerprint, bytesParsed: number): FuzzyIndexSnapshot => ({
    version: FUZZY_INDEX_STORE_VERSION,
    createdAt: Date.now(),
    rowCount: 100,
    bytesParsed,
    tokenLimit: 50000,
    trigramSize: 3,
    fingerprint,
    columns: []
  });

  it('returns true when fingerprint and file size align', () => {
    const fingerprint: FuzzyIndexFingerprint = {
      fileName: 'records.csv',
      fileSize: 4096,
      lastModified: 1234
    };

    const snapshot = buildSnapshot(fingerprint, 4096);
    expect(fuzzySnapshotMatchesFingerprint(snapshot, fingerprint)).toBe(true);
  });

  it('returns false when fingerprint metadata differs', () => {
    const fingerprint: FuzzyIndexFingerprint = {
      fileName: 'records.csv',
      fileSize: 4096,
      lastModified: 1234
    };
    const snapshot = buildSnapshot(
      {
        ...fingerprint,
        fileName: 'other.csv'
      },
      4096
    );

    expect(fuzzySnapshotMatchesFingerprint(snapshot, fingerprint)).toBe(false);
  });

  it('returns false when parsed bytes do not match file size', () => {
    const fingerprint: FuzzyIndexFingerprint = {
      fileName: 'records.csv',
      fileSize: 4096,
      lastModified: 1234
    };
    const snapshot = buildSnapshot(fingerprint, 1024);

    expect(fuzzySnapshotMatchesFingerprint(snapshot, fingerprint)).toBe(false);
  });
});

describe('dataWorkerApi integration harness', () => {
  const buildCallbacks = () => {
    const events: {
      columns?: string[];
      complete?: LoadCompleteSummary;
      progress: Array<{ rowsParsed: number; bytesParsed: number; batchesStored: number }>;
    } = { progress: [] };

    return {
      events,
      callbacks: {
        onStart: ({ columns }: { columns: string[] }) => {
          events.columns = columns;
        },
        onProgress: (progress: { rowsParsed: number; bytesParsed: number; batchesStored: number }) => {
          events.progress.push(progress);
        },
        onComplete: (summary: LoadCompleteSummary) => {
          events.complete = summary;
        }
      }
    };
  };

  it('loads CSV content and exposes rows via fetchRows', async () => {
    const worker = createDataWorkerApi();
    await worker.init({ chunkSize: 256 });

    const handle = createMockFileHandle('name,age\nAlice,30\nBob,25\n');
    const { events, callbacks } = buildCallbacks();

    await worker.loadFile({ handle, batchSize: 64 }, callbacks);

    const snapshot = await worker.fetchRows({ offset: 0, limit: 10 });
    expect(snapshot.totalRows).toBe(2);
    expect(snapshot.matchedRows).toBe(2);
    expect(snapshot.rows.map((row) => row.name)).toEqual(['Alice', 'Bob']);
    expect(snapshot.rows.map((row) => row.age)).toEqual([30, 25]);

    expect(events.columns).toEqual(['name', 'age']);
    expect(events.progress.length).toBeGreaterThan(0);
    expect(events.complete?.rowsParsed).toBe(2);
    expect(events.complete?.columnTypes).toEqual({ name: 'string', age: 'number' });
    expect(events.complete?.columnInference.age.type).toBe('number');
  });

  it('applies filters and updates subsequent fetchRows calls', async () => {
    const worker = createDataWorkerApi();
    await worker.init({});

    const handle = createMockFileHandle('name,city\nAlice,Paris\nBob,London\nCarol,Paris\n');
    await worker.loadFile({ handle }, {});

    const expression: FilterNode = {
      column: 'city',
      operator: 'eq',
      value: 'Paris',
      id: 'city-eq'
    };

    const result = await worker.applyFilter({ expression, offset: 0, limit: 10 });
    expect(result.matchedRows).toBe(2);
    expect(result.rows.map((row) => row.name)).toEqual(['Alice', 'Carol']);

    const filteredWindow = await worker.fetchRows({ offset: 0, limit: 10 });
    expect(filteredWindow.matchedRows).toBe(2);
    expect(filteredWindow.rows.map((row) => row.name)).toEqual(['Alice', 'Carol']);
  });
});
