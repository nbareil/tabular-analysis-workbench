// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeColumn, encodeSparseColumn, RowBatchStore, ROW_CACHE_DIRECTORY, type BatchView } from './rowBatchStore';
import type { RowBatch } from './types';

const makeBatch = (rowStart: number, columns: Record<string, string[]>): RowBatch => {
  const rowCount = Object.values(columns)[0]!.length;
  return {
    rowIds: Uint32Array.from({ length: rowCount }, (_, index) => rowStart + index),
    columns: Object.fromEntries(Object.entries(columns).map(([name, values]) => [name, encodeColumn(values)])),
    columnTypes: {},
    columnInference: {},
    stats: { rowsParsed: rowStart + rowCount, bytesParsed: 0, malformedRows: 0, eof: false }
  };
};

const fillStore = async (store: RowBatchStore): Promise<void> => {
  await store.storeBatch(makeBatch(0, { name: ['alice', 'bob'], city: ['Zürich', ''] }));
  await store.storeBatch(makeBatch(2, { name: ['carol'], city: ['Paris'] }));
  await store.storeBatch(makeBatch(3, { name: ['dave', '日本'], city: ['Oslo', 'Tokyo'] }));
};

const collect = async (store: RowBatchStore): Promise<BatchView[]> => {
  const views: BatchView[] = [];
  for await (const view of store.iterateBatches()) {
    views.push(view);
  }
  return views;
};

const sharedBehaviour = (createStore: () => Promise<RowBatchStore>) => {
  it('iterates batches with row offsets and decoded columns', async () => {
    const store = await createStore();
    await fillStore(store);
    expect(store.totalRows).toBe(5);
    expect(store.batchCount).toBe(3);

    const views = await collect(store);
    expect(views.map((view) => [view.rowStart, view.rowCount])).toEqual([
      [0, 2],
      [2, 1],
      [3, 2]
    ]);
    expect(views.flatMap((view) => view.column('city'))).toEqual(['Zürich', '', 'Paris', 'Oslo', 'Tokyo']);
    expect(views[0]!.column('missing')).toEqual(['', '']);
  });

  it('returns rows in the requested order across batches and skips unknown ids', async () => {
    const store = await createStore();
    await fillStore(store);
    const rows = await store.getRows([4, 0, 2, 99, 1]);
    expect(rows).toEqual([
      { __rowId: 4, name: '日本', city: 'Tokyo' },
      { __rowId: 0, name: 'alice', city: 'Zürich' },
      { __rowId: 2, name: 'carol', city: 'Paris' },
      { __rowId: 1, name: 'bob', city: '' }
    ]);
  });

  it('starts empty', async () => {
    const store = await createStore();
    expect(store.totalRows).toBe(0);
    expect(await store.getRows([0])).toEqual([]);
  });

  it('reads sparse columns as empty cells wherever they have no value', async () => {
    const store = await createStore();
    await store.storeBatch(sparseBatch());

    const [view] = await collect(store);
    expect(view!.column('rare')).toEqual(['', 'ü', '', '']);
    expect(view!.cells('rare')).toEqual({ rows: Uint32Array.from([1]), values: ['ü'] });
    expect(view!.cells('id')).toEqual({ rows: null, values: ['a', 'b', 'c', 'd'] });
    expect(view!.cells('missing')).toEqual({ rows: new Uint32Array(0), values: [] });
    expect(await store.getRows([1, 2])).toEqual([
      { __rowId: 1, id: 'b', rare: 'ü' },
      { __rowId: 2, id: 'c' }
    ]);
  });

  it('never mistakes a column name for an Object.prototype member', async () => {
    const store = await createStore();
    await store.storeBatch(makeBatch(0, { id: ['a'] }));
    const [view] = await collect(store);
    expect(view!.column('constructor')).toEqual(['']);
    expect(view!.cells('toString').values).toEqual([]);
  });
};

/** Four rows; `rare` has a value in row 1 only. */
const sparseBatch = (rowStart = 0): RowBatch => ({
  ...makeBatch(rowStart, { id: ['a', 'b', 'c', 'd'] }),
  columns: { id: encodeColumn(['a', 'b', 'c', 'd']), rare: encodeSparseColumn([1], ['ü'], 4) }
});

describe('encodeColumn', () => {
  const decodeAll = (values: string[]) => {
    const { data, offsets } = encodeColumn(values);
    const bytes = new Uint8Array(data);
    return Array.from({ length: values.length }, (_, index) =>
      new TextDecoder().decode(bytes.subarray(offsets[index]!, offsets[index + 1]!))
    );
  };

  it('round-trips ASCII, multi-byte and astral text cell by cell', () => {
    const values = ['', 'plain', 'Zürich', '日本', '🚀 launch', 'é', ''];
    expect(decodeAll(values)).toEqual(values);
  });

  it('keeps lone surrogates in their own cell even when neighbours would pair them', () => {
    // TextEncoder writes each lone surrogate as U+FFFD; joined, these two would form one emoji.
    expect(decodeAll(['a\uD83D', '\uDE80b', '\uDC00'])).toEqual(['a�', '�b', '�']);
  });
});

describe('encodeSparseColumn', () => {
  it('stores only the given cells when fewer than half the rows have one', () => {
    expect(encodeSparseColumn([1], ['x'], 4).rows).toEqual(Uint32Array.from([1]));
  });

  it('stores a cell per row once half the rows have one', () => {
    const column = encodeSparseColumn([0, 2], ['x', 'y'], 4);
    expect(column.rows).toBeUndefined();
    expect(Array.from(column.offsets)).toEqual([0, 1, 1, 2, 2]);
  });
});

describe('RowBatchStore without OPFS (memory fallback)', () => {
  sharedBehaviour(() => RowBatchStore.create('memory'));
});

class MockWritable {
  constructor(private readonly file: MockFileHandle) {}
  private parts: Blob[] = [];
  async write(data: Blob): Promise<void> {
    this.parts.push(data);
  }
  async close(): Promise<void> {
    this.file.content = new Blob(this.parts);
  }
}

class MockFileHandle {
  content: Blob = new Blob([]);
  reads = 0;
  async createWritable(): Promise<MockWritable> {
    return new MockWritable(this);
  }
  async getFile(): Promise<Blob> {
    this.reads += 1;
    return this.content;
  }
}

class MockDirectory {
  readonly files = new Map<string, MockFileHandle>();
  readonly directories = new Map<string, MockDirectory>();
  async getFileHandle(name: string): Promise<MockFileHandle> {
    if (!this.files.has(name)) {
      this.files.set(name, new MockFileHandle());
    }
    return this.files.get(name)!;
  }
  async getDirectoryHandle(name: string): Promise<MockDirectory> {
    if (!this.directories.has(name)) {
      this.directories.set(name, new MockDirectory());
    }
    return this.directories.get(name)!;
  }
  async removeEntry(name: string): Promise<void> {
    this.directories.delete(name);
    this.files.delete(name);
  }
  async *keys(): AsyncGenerator<string> {
    yield* this.directories.keys();
    yield* this.files.keys();
  }
}

describe('RowBatchStore with OPFS', () => {
  let root: MockDirectory;

  const stubOpfs = (locks?: unknown) => {
    root = new MockDirectory();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root }, locks });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  sharedBehaviour(async () => {
    stubOpfs();
    return RowBatchStore.create('opfs');
  });

  it('writes one file per batch and reads evicted batches back from disk', async () => {
    stubOpfs();
    const store = await RowBatchStore.create('opfs');
    for (let batch = 0; batch < 12; batch += 1) {
      await store.storeBatch(makeBatch(batch * 2, { v: [`r${batch * 2}`, `r${batch * 2 + 1}`] }));
    }
    const baseDir = root.directories.get(ROW_CACHE_DIRECTORY)!;
    const [datasetDir] = baseDir.directories.values();
    expect(datasetDir!.files.size).toBe(12);

    const rows = await store.getRows([0, 23, 5]);
    expect(rows.map((row) => row.v)).toEqual(['r0', 'r23', 'r5']);
    const firstFile = datasetDir!.files.get('batch-000000.bin')!;
    expect(firstFile.reads).toBeGreaterThan(0);

    const all = (await collect(store)).flatMap((view) => view.column('v'));
    expect(all).toEqual(Array.from({ length: 24 }, (_, index) => `r${index}`));
  });

  it('reads an evicted sparse batch back from disk', async () => {
    stubOpfs();
    const store = await RowBatchStore.create('opfs');
    await store.storeBatch(sparseBatch());
    for (let batch = 1; batch <= 8; batch += 1) {
      await store.storeBatch(makeBatch(batch * 4, { id: ['w', 'x', 'y', 'z'] }));
    }
    const firstFile = root.directories.get(ROW_CACHE_DIRECTORY)!.directories.values().next().value!.files.get('batch-000000.bin')!;
    expect(firstFile.reads).toBe(0);

    expect(await store.getRows([1, 0])).toEqual([
      { __rowId: 1, id: 'b', rare: 'ü' },
      { __rowId: 0, id: 'a' }
    ]);
    expect(firstFile.reads).toBe(1);
    const [view] = await collect(store);
    expect(view!.column('rare')).toEqual(['', 'ü', '', '']);
  });

  it('deletes its directory on dispose', async () => {
    stubOpfs();
    const store = await RowBatchStore.create('opfs');
    await store.storeBatch(makeBatch(0, { v: ['x'] }));
    const baseDir = root.directories.get(ROW_CACHE_DIRECTORY)!;
    expect(baseDir.directories.size).toBe(1);
    await store.dispose();
    expect(baseDir.directories.size).toBe(0);
    expect(store.totalRows).toBe(0);
  });

  it('sweeps stale directories whose lock is no longer held', async () => {
    const held: Array<{ name: string }> = [];
    const locks = {
      request: (name: string, callback: () => Promise<void>) => {
        held.push({ name });
        return callback();
      },
      query: async () => ({ held: held.slice() })
    };
    stubOpfs(locks);
    const baseDir = await root.getDirectoryHandle(ROW_CACHE_DIRECTORY);
    await baseDir.getDirectoryHandle('stale-dataset');

    const store = await RowBatchStore.create('opfs');
    expect(baseDir.directories.has('stale-dataset')).toBe(false);
    expect(baseDir.directories.size).toBe(1);
    await store.dispose();
  });
});
