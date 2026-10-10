// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import { createIngestionPipeline, SOURCE_COLUMN } from './ingestionPipeline';
import { createDataWorkerState } from '../state/dataWorkerState';
import { createMockFileHandle } from '../test/mockFileHandle';
import type { LoadFileCallbacks, LoadProgress } from '../workerApiTypes';

const setup = () => {
  const state = createDataWorkerState();
  return { state, pipeline: createIngestionPipeline(state) };
};

const allRows = async (state: ReturnType<typeof createDataWorkerState>) =>
  state.dataset.batchStore!.getRows(Array.from({ length: state.dataset.totalRows }, (_, index) => index));

/** Rows without their empty cells, which sparse and dense columns represent differently. */
const filledRows = async (state: ReturnType<typeof createDataWorkerState>) =>
  (await allRows(state)).map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '')));

describe('ingestionPipeline', () => {
  it('loads a single file and reports start, progress and completion', async () => {
    const { state, pipeline } = setup();
    const onColumns = vi.fn();
    const progress: LoadProgress[] = [];
    const onComplete = vi.fn();
    const onError = vi.fn();

    await pipeline.run(
      { handles: [createMockFileHandle('name,age\nAlice,30\nBob,25\nCarol,41\n', { name: 'people.csv' })], batchSize: 1 },
      { onColumns, onProgress: (entry) => void progress.push(entry), onComplete, onError }
    );

    expect(onColumns).toHaveBeenCalledWith({ columns: ['name', 'age'] });
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress.at(-1)?.rowsParsed).toBe(3);
    expect(onError).not.toHaveBeenCalled();
    const summary = onComplete.mock.calls[0]![0];
    expect(summary.rowsParsed).toBe(3);
    expect(summary.columnTypes).toEqual({ name: 'string', age: 'number' });
    expect(summary.columnInference.age.type).toBe('number');

    expect(state.dataset.loading).toBe(false);
    expect(state.dataset.fileName).toBe('people.csv');
    expect(state.dataset.header).toEqual(['name', 'age']);
    expect((await allRows(state)).map((row) => row.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('merges several files with a source_file column, a header union and merged types', async () => {
    const { state, pipeline } = setup();
    const onComplete = vi.fn();
    await pipeline.run(
      {
        handles: [
          createMockFileHandle('host,count,value\nalpha,1,10\nbeta,2,20\n', { name: 'a.csv' }),
          createMockFileHandle('host,count,value,user\ngamma,3,high,root\n', { name: 'b.csv' })
        ]
      },
      { onComplete }
    );

    expect(state.dataset.header).toEqual([SOURCE_COLUMN, 'host', 'count', 'value', 'user']);
    expect(state.dataset.fileName).toBe('a.csv+b.csv');
    expect(state.dataset.totalRows).toBe(3);
    const types = onComplete.mock.calls[0]![0].columnTypes;
    expect(types[SOURCE_COLUMN]).toBe('string');
    expect(types.count).toBe('number');
    // a.csv infers numbers, b.csv text: disagreement falls back to text.
    expect(types.value).toBe('string');
    expect(types.user).toBe('string');

    const rows = await allRows(state);
    expect(rows.map((row) => row[SOURCE_COLUMN])).toEqual(['a.csv', 'a.csv', 'b.csv']);
    expect(rows.map((row) => row.host)).toEqual(['alpha', 'beta', 'gamma']);
    expect(rows[2]!.user).toBe('root');
    expect(rows[0]!.user ?? '').toBe('');
  });

  it('detects gzip from magic bytes regardless of file name', async () => {
    const { state, pipeline } = setup();
    const compressed = new Uint8Array(gzipSync(Buffer.from('id,label\n1,one\n2,two\n')));
    await pipeline.run({ handles: [createMockFileHandle(compressed, { name: 'export.log' })] }, {});

    expect(state.dataset.header).toEqual(['id', 'label']);
    expect((await allRows(state)).map((row) => row.label)).toEqual(['one', 'two']);
  });

  it('loads JSON Lines recognised from the content, whatever the file name', async () => {
    const { state, pipeline } = setup();
    const onComplete = vi.fn();
    await pipeline.run(
      { handles: [createMockFileHandle('\n{"id":1,"user":{"name":"alice"}}\n{"id":2,"user":{"name":"bob"},"tags":[1]}\n', { name: 'events.log' })] },
      { onComplete }
    );

    expect(state.dataset.header).toEqual(['id', 'user.name', 'tags']);
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      columns: ['id', 'user.name', 'tags'],
      rowsParsed: 2,
      malformedRows: 0,
      columnTypes: { id: 'number', 'user.name': 'string', tags: 'string' }
    });
    expect(await filledRows(state)).toEqual([
      { __rowId: 0, id: '1', 'user.name': 'alice' },
      { __rowId: 1, id: '2', 'user.name': 'bob', tags: '[1]' }
    ]);
  });

  it('reports JSON Lines columns as new keys appear and keeps known types meanwhile', async () => {
    const { state, pipeline } = setup();
    const reported: string[][] = [];
    const typesWhenReported: Array<string | undefined> = [];
    const onComplete = vi.fn();
    await pipeline.run(
      {
        handles: [createMockFileHandle('{"when":"2024-01-01T00:00:00Z","a":{"x":1}}\n{"b":2}\n{"a":{"y":3}}\n')],
        batchSize: 1
      },
      {
        onColumns: ({ columns }) => {
          reported.push(columns);
          typesWhenReported.push(state.dataset.columnTypes.when);
        },
        onComplete
      }
    );

    expect(reported).toEqual([
      ['when', 'a.x'],
      ['when', 'a.x', 'b'],
      ['when', 'a.x', 'a.y', 'b']
    ]);
    // A filter that runs while the UI handles the callback must still see the inferred type.
    expect(typesWhenReported).toEqual(['string', 'datetime', 'datetime']);
    expect(onComplete.mock.calls[0]![0].columns).toEqual(['when', 'a.x', 'a.y', 'b']);
    expect(state.dataset.totalRows).toBe(3);
  });

  it('loads gzip-compressed JSON Lines and counts malformed lines', async () => {
    const { state, pipeline } = setup();
    const onComplete = vi.fn();
    const compressed = new Uint8Array(gzipSync(Buffer.from('{"a":"x"}\n{"a":\n')));
    await pipeline.run({ handles: [createMockFileHandle(compressed, { name: 'events.jsonl.gz' })] }, { onComplete });

    expect(onComplete.mock.calls[0]![0]).toMatchObject({ rowsParsed: 2, malformedRows: 1 });
    expect(await filledRows(state)).toEqual([
      { __rowId: 0, a: 'x' },
      { __rowId: 1, malformed_line: '{"a":' }
    ]);
  });

  it('merges delimited and JSON Lines files into one timeline', async () => {
    const { state, pipeline } = setup();
    await pipeline.run(
      {
        handles: [
          createMockFileHandle('host,event\nWS01,logon\n', { name: 'a.csv' }),
          createMockFileHandle('{"host":"WS02","user":{"name":"bob"},"source_file":"x"}\n', { name: 'b.jsonl' })
        ]
      },
      {}
    );

    expect(state.dataset.header).toEqual([SOURCE_COLUMN, 'host', 'event', 'user.name', 'source_file_2']);
    expect(await filledRows(state)).toEqual([
      { __rowId: 0, [SOURCE_COLUMN]: 'a.csv', host: 'WS01', event: 'logon' },
      { __rowId: 1, [SOURCE_COLUMN]: 'b.jsonl', host: 'WS02', 'user.name': 'bob', source_file_2: 'x' }
    ]);
  });

  it.each([
    ['a JSON array', '[{"a":1},\n{"a":2}]\n'],
    ['pretty-printed JSON', '{\r\n  "a": 1\r\n}\r\n']
  ])('rejects %s with a hint to convert it', async (_name, text) => {
    const { pipeline } = setup();
    const onError = vi.fn();
    await expect(
      pipeline.run({ handles: [createMockFileHandle(text, { name: 'export.json' })] }, { onError })
    ).rejects.toThrow('export.json is a JSON document, not JSON Lines');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("jq -c '.[]'") }));
  });

  it('reports errors through onError and rejects', async () => {
    const { pipeline } = setup();
    const onError = vi.fn();
    await expect(pipeline.run({ handles: [] }, { onError })).rejects.toThrow('Select at least one file');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Select at least one file to open.' }));
  });

  it('a second load started immediately supersedes the first', async () => {
    const { state, pipeline } = setup();
    const firstError = vi.fn();
    const first = pipeline.run({ handles: [createMockFileHandle('a\n1\n', { name: 'first.csv' })] }, { onError: firstError });
    const second = pipeline.run({ handles: [createMockFileHandle('b\n2\n3\n', { name: 'second.csv' })] }, {});

    await expect(first).rejects.toMatchObject({ name: 'StaleOperationError' });
    await second;
    expect(firstError).not.toHaveBeenCalled();
    expect(state.dataset.fileName).toBe('second.csv');
    expect(state.dataset.header).toEqual(['b']);
    expect(state.dataset.totalRows).toBe(2);
  });

  it('a load superseded mid-parse never leaks rows or schema into the newer dataset', async () => {
    const { state, pipeline } = setup();
    let secondStarted!: () => void;
    const secondStartedPromise = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    let second: Promise<void> | null = null;
    const firstCallbacks: LoadFileCallbacks = {
      onColumns: async () => {
        // Start the newer load while the first is parsing, and let it reach its own header first.
        second = pipeline.run(
          { handles: [createMockFileHandle('city\nParis\n', { name: 'second.csv' })] },
          { onColumns: () => secondStarted() }
        );
        await secondStartedPromise;
      },
      onProgress: vi.fn(),
      onComplete: vi.fn()
    };

    const first = pipeline.run(
      { handles: [createMockFileHandle('name,age\nAlice,1\nBob,2\n', { name: 'first.csv' })], batchSize: 1 },
      firstCallbacks
    );

    await expect(first).rejects.toMatchObject({ name: 'StaleOperationError' });
    await second;
    expect(firstCallbacks.onProgress).not.toHaveBeenCalled();
    expect(firstCallbacks.onComplete).not.toHaveBeenCalled();
    expect(state.dataset.fileName).toBe('second.csv');
    expect(state.dataset.header).toEqual(['city']);
    expect(state.dataset.totalRows).toBe(1);
    expect(await allRows(state)).toEqual([{ __rowId: 0, city: 'Paris' }]);
  });

  it('rejects a superseded load whose stream is still open', async () => {
    const { state, pipeline } = setup();
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(encoder.encode('name\nAlice\n'));
        }
      });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = pipeline.run(
      { handles: [createMockFileHandle('name\nAlice\nBob\n', { name: 'first.csv', stream })] },
      { onColumns: () => firstStarted() }
    );
    first.catch(() => undefined);
    await started;
    await pipeline.run({ handles: [createMockFileHandle('x\n1\n', { name: 'second.csv' })] }, {});
    try {
      // Feed the rest unless the superseded load already cancelled its reader.
      streamController.enqueue(encoder.encode('Bob\n'));
      streamController.close();
    } catch {
      // Stream already cancelled.
    }

    await expect(first).rejects.toMatchObject({ name: 'StaleOperationError' });
    expect(state.dataset.fileName).toBe('second.csv');
    expect(state.dataset.header).toEqual(['x']);
    expect(state.dataset.totalRows).toBe(1);
  });
});
