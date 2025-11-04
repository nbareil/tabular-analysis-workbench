import { describe, expect, it } from 'vitest';

import type { FuzzyIndexSnapshot, FuzzyIndexFingerprint } from './fuzzyIndexStore';
import { FUZZY_INDEX_STORE_VERSION } from './fuzzyIndexStore';
import { createFuzzyFingerprint, fuzzySnapshotMatchesFingerprint } from './fuzzyIndexUtils';

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
