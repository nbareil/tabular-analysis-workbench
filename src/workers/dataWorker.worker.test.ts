import { describe, expect, it, vi } from 'vitest';

import { createDataWorkerApi } from './dataWorker.worker';
import { createDatasetFingerprint } from './datasetFingerprint';
import { RowBatchStore } from './rowBatchStore';
import type { LoadCompleteSummary } from './workerApiTypes';
import type { FilterNode } from './types';
import { createMockFileHandle } from './test/mockFileHandle';

describe('createDatasetFingerprint', () => {
  it('derives fingerprint metadata from file properties', () => {
    const file = {
      name: 'events.csv',
      size: 1024,
      lastModified: 987654321
    } as unknown as File;

    const handle = {
      name: 'fallback.csv'
    } as FileSystemFileHandle;

    const fingerprint = createDatasetFingerprint(file, handle);

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

    const fingerprint = createDatasetFingerprint(file, handle);
    expect(fingerprint.fileName).toBe('session.tsv');
    expect(fingerprint.fileSize).toBe(0);
    expect(fingerprint.lastModified).toBe(0);
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

  it('returns did-you-mean suggestions for zero-match equality filters', async () => {
    const worker = createDataWorkerApi();
    await worker.init({});

    const handle = createMockFileHandle('message\nlogin success\npayment complete\n');
    await worker.loadFile({ handle }, {});

    const expression: FilterNode = {
      column: 'message',
      operator: 'eq',
      value: 'login sucess',
      id: 'message-eq'
    };

    const result = await worker.applyFilter({ expression, offset: 0, limit: 10 });
    expect(result.matchedRows).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.didYouMean?.suggestions).toContain('login success');
  });

  it('pages search results through fetchRows and keeps sorting functional', async () => {
    const worker = createDataWorkerApi();
    await worker.init({});

    const handle = createMockFileHandle(
      'name,city\nAlice,Paris\nBob,London\nCarol,Paris\nDave,Lisbon\n'
    );
    await worker.loadFile({ handle }, {});

    const searchResult = await worker.globalSearch({
      query: 'par',
      columns: ['city'],
      caseSensitive: false
    });
    expect(searchResult).toEqual({
      totalRows: 4,
      matchedRows: 2
    });

    const searchWindow = await worker.fetchRows({ offset: 0, limit: 10 });
    expect(searchWindow.matchedRows).toBe(2);
    expect(searchWindow.rows.map((row) => row.name)).toEqual(['Alice', 'Carol']);

    await worker.applySorts({
      sorts: [{ column: 'name', direction: 'desc' }],
      offset: 0,
      limit: 0
    });

    const sortedSearchWindow = await worker.fetchRows({ offset: 0, limit: 10 });
    expect(sortedSearchWindow.rows.map((row) => row.name)).toEqual(['Carol', 'Alice']);
  });

  it('searches within the filtered row set instead of the full dataset', async () => {
    const worker = createDataWorkerApi();
    await worker.init({});

    const handle = createMockFileHandle(
      'name,city\nAlice,Paris\nBob,Paris\nCarol,London\nDave,Paris\n'
    );
    await worker.loadFile({ handle }, {});

    const expression: FilterNode = {
      column: 'city',
      operator: 'eq',
      value: 'Paris',
      id: 'city-paris'
    };
    await worker.applyFilter({ expression, offset: 0, limit: 10 });

    const searchResult = await worker.globalSearch({
      query: 'a',
      columns: ['name'],
      caseSensitive: false
    });
    expect(searchResult).toEqual({
      totalRows: 3,
      matchedRows: 2
    });

    const searchWindow = await worker.fetchRows({ offset: 0, limit: 10 });
    expect(searchWindow.rows.map((row) => row.name)).toEqual(['Alice', 'Dave']);
  });

  it('returns column value distributions for repeated string values', async () => {
    const worker = createDataWorkerApi();
    await worker.init({});

    const handle = createMockFileHandle('city\nParis\nLondon\nParis\nParis\nLondon\n');
    await worker.loadFile({ handle }, {});

    const distribution = await worker.getColumnValueDistribution({ column: 'city' });

    expect(distribution).toEqual({
      column: 'city',
      totalRows: 5,
      nonNullRows: 5,
      distinctCount: 2,
      skipped: false,
      defaultSort: 'desc',
      items: [
        { value: 'Paris', count: 3 },
        { value: 'London', count: 2 }
      ]
    });
  });

  it('preserves fetched UTF-8 string rows before and after frequency indexing traversal', async () => {
    const worker = createDataWorkerApi();
    await worker.init({});

    const handle = createMockFileHandle(
      'city,note\nMünchen,"emoji 🚀"\nQuébec,"café crème"\n東京,"night shift"\nMünchen,"repeat"\nQuébec,"follow up"\nMünchen,"late shift"\n'
    );
    await worker.loadFile({ handle, batchSize: 1 }, {});

    const before = await worker.fetchRows({ offset: 0, limit: 6 });
    expect(before.rows.map((row) => row.city)).toEqual([
      'München',
      'Québec',
      '東京',
      'München',
      'Québec',
      'München'
    ]);
    expect(before.rows.map((row) => row.note)).toEqual([
      'emoji 🚀',
      'café crème',
      'night shift',
      'repeat',
      'follow up',
      'late shift'
    ]);

    const distribution = await worker.getColumnValueDistribution({ column: 'city' });
    expect(distribution.items[0]).toEqual({ value: 'München', count: 3 });

    const after = await worker.fetchRows({ offset: 0, limit: 6 });
    expect(after.rows.map((row) => row.city)).toEqual([
      'München',
      'Québec',
      '東京',
      'München',
      'Québec',
      'München'
    ]);
    expect(after.rows.map((row) => row.note)).toEqual([
      'emoji 🚀',
      'café crème',
      'night shift',
      'repeat',
      'follow up',
      'late shift'
    ]);
  });

  it('reuses the cached value distribution for repeated requests on the same column', async () => {
    const worker = createDataWorkerApi();
    await worker.init({});

    const handle = createMockFileHandle('city\nParis\nLondon\nParis\nParis\nLondon\n');
    await worker.loadFile({ handle }, {});

    const iterateSpy = vi.spyOn(RowBatchStore.prototype, 'iterateMaterializedBatches');

    const first = await worker.getColumnValueDistribution({ column: 'city' });
    const second = await worker.getColumnValueDistribution({ column: 'city' });

    expect(second).toEqual(first);
    expect(iterateSpy).toHaveBeenCalledTimes(1);

    iterateSpy.mockRestore();
  });

  it('skips value distributions when distinct values exceed 50 percent of total rows', async () => {
    const worker = createDataWorkerApi();
    await worker.init({});

    const handle = createMockFileHandle('name\nalpha\nbeta\ngamma\ndelta\nalpha\nzeta\n');
    await worker.loadFile({ handle }, {});

    const distribution = await worker.getColumnValueDistribution({ column: 'name' });

    expect(distribution.skipped).toBe(true);
    expect(distribution.distinctCount).toBe(5);
    expect(distribution.items).toEqual([]);
    expect(distribution.skipReason).toBe('Too many unique values');
  });

  it('keeps value distributions when distinct values stay at or below 50 percent', async () => {
    const worker = createDataWorkerApi();
    await worker.init({});

    const handle = createMockFileHandle('active\ntrue\nfalse\ntrue\nfalse\n');
    await worker.loadFile({ handle }, {});

    const distribution = await worker.getColumnValueDistribution({ column: 'active' });

    expect(distribution.skipped).toBe(false);
    expect(distribution.distinctCount).toBe(2);
    expect(distribution.items).toEqual([
      { value: 'false', count: 2 },
      { value: 'true', count: 2 }
    ]);
  });
});
