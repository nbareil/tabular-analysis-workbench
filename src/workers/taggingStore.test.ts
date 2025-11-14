import { describe, expect, it } from 'vitest';

import type { FuzzyIndexFingerprint } from './fuzzyIndexStore';
import { buildTaggingStoreKey } from './taggingStore';

describe('buildTaggingStoreKey', () => {
  it('slugifies the file name and appends size + timestamp metadata', () => {
    const fingerprint: FuzzyIndexFingerprint = {
      fileName: 'Case File.csv',
      fileSize: 123_456,
      lastModified: 1_730_000_000_000
    };

    expect(buildTaggingStoreKey(fingerprint)).toBe('case-file-csv-123456-1730000000000');
  });

  it('falls back to dataset prefix when metadata is missing', () => {
    const fingerprint: FuzzyIndexFingerprint = {
      fileName: '',
      fileSize: NaN,
      lastModified: NaN
    };

    expect(buildTaggingStoreKey(fingerprint)).toBe('dataset-0-0');
  });
});
