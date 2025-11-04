import { describe, expect, it } from 'vitest';

import { detectCompression } from './detectCompression';

describe('detectCompression', () => {
  it('returns gzip for .csv.gz files', () => {
    expect(detectCompression({ fileName: 'metrics.csv.gz' })).toBe('gzip');
  });

  it('returns gzip for .tsv.gzip files', () => {
    expect(detectCompression({ fileName: 'events.tsv.gzip' })).toBe('gzip');
  });

  it('ignores gzip files without CSV or TSV base extension', () => {
    expect(detectCompression({ fileName: 'data.json.gz' })).toBeNull();
  });

  it('falls back to gzip when mime type is application/gzip', () => {
    expect(detectCompression({ fileName: 'metrics.backup', mimeType: 'application/gzip' })).toBe(
      'gzip'
    );
  });

  it('returns null for plain csv files', () => {
    expect(detectCompression({ fileName: 'metrics.csv' })).toBeNull();
  });
});
