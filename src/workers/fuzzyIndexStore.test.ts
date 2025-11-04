import { describe, expect, it } from 'vitest';

import {
  deserializeFuzzyIndexSnapshot,
  serializeFuzzyIndexSnapshot,
  type FuzzyIndexSnapshot
} from './fuzzyIndexStore';

const createSampleSnapshot = (): FuzzyIndexSnapshot => ({
  version: 1,
  createdAt: 1234567890,
  rowCount: 1000,
  bytesParsed: 2048,
  tokenLimit: 50000,
  trigramSize: 3,
  fingerprint: {
    fileName: 'sample.csv',
    fileSize: 1024,
    lastModified: 987654321
  },
  columns: [
    {
      key: 'message',
      truncated: false,
      tokens: [
        { id: 1, token: 'error', frequency: 10 },
        { id: 2, token: 'warning', frequency: 5 }
      ],
      trigramIndex: {
        err: Uint32Array.from([1, 1, 1]),
        ing: Uint32Array.from([2, 2])
      }
    },
    {
      key: 'user',
      truncated: true,
      tokens: [{ id: 1, token: 'alice', frequency: 3 }],
      trigramIndex: {
        ali: Uint32Array.from([1]),
        ice: Uint32Array.from([1, 4])
      }
    }
  ]
});

describe('fuzzyIndexStore serialization', () => {
  it('round-trips a snapshot and preserves typed arrays', () => {
    const snapshot = createSampleSnapshot();
    const serialized = serializeFuzzyIndexSnapshot(snapshot);
    const restored = deserializeFuzzyIndexSnapshot(serialized);

    expect(restored).not.toBeNull();
    expect(restored?.fingerprint).toEqual(snapshot.fingerprint);
    expect(restored?.columns.length).toBe(snapshot.columns.length);

    const firstColumn = restored?.columns[0];
    expect(firstColumn?.tokens).toEqual(snapshot.columns[0]!.tokens);
    expect(firstColumn?.trigramIndex.err).toBeInstanceOf(Uint32Array);
    expect(Array.from(firstColumn?.trigramIndex.err ?? [])).toEqual([1, 1, 1]);
  });

  it('clamps trigram token ids to valid unsigned integers', () => {
    const restored = deserializeFuzzyIndexSnapshot({
      version: 1,
      createdAt: 0,
      rowCount: 0,
      bytesParsed: 0,
      tokenLimit: 0,
      trigramSize: 3,
      fingerprint: {
        fileName: 'sample.csv',
        fileSize: 1024,
        lastModified: 123
      },
      columns: [
        {
          key: 'user',
          truncated: false,
          tokens: [],
          trigramIndex: {
            ice: [1, -1, Number.NaN, 9999999999]
          }
        }
      ]
    });

    expect(restored).not.toBeNull();
    expect(Array.from(restored!.columns[0]!.trigramIndex.ice)).toEqual([1, 4294967295]);
  });

  it('rejects payloads with unexpected version', () => {
    expect(
      deserializeFuzzyIndexSnapshot({
        version: 999,
        createdAt: 0,
        rowCount: 0,
        bytesParsed: 0,
        tokenLimit: 0,
        trigramSize: 3,
        fingerprint: {
          fileName: 'sample.csv',
          fileSize: 0,
          lastModified: 0
        },
        columns: []
      })
    ).toBeNull();
  });

  it('rejects payloads lacking fingerprint metadata', () => {
    expect(
      deserializeFuzzyIndexSnapshot({
        version: 1,
        createdAt: 0,
        rowCount: 0,
        bytesParsed: 0,
        tokenLimit: 0,
        trigramSize: 3,
        columns: []
      })
    ).toBeNull();
  });
});
