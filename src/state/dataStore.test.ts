import { beforeEach, describe, expect, it } from 'vitest';

import { useDataStore } from './dataStore';

const summaryPayload = {
  rowsParsed: 100,
  bytesParsed: 1024,
  durationMs: 500,
  columnTypes: {
    alpha: 'string'
  },
  columnInference: {
    alpha: {
      confidence: 0.9,
      samples: 100,
      nullCount: 0,
      examples: ['foo', 'bar'],
      type: 'string'
    }
  }
} as const;

describe('useDataStore matched row fallbacks', () => {
  beforeEach(() => {
    useDataStore.getState().reset();
    // Load a dataset into the store so totalRows reflects a populated grid.
    useDataStore.getState().complete(summaryPayload);
  });

  it('preserves total row count when clearing search results without filters', () => {
    expect(useDataStore.getState().matchedRows).toBe(summaryPayload.rowsParsed);

    useDataStore.getState().clearSearchResult();

    expect(useDataStore.getState().matchedRows).toBe(summaryPayload.rowsParsed);
  });

  it('restores total row count when clearing filter summaries with no active search', () => {
    useDataStore.getState().setFilterSummary({ matchedRows: 25, totalRows: summaryPayload.rowsParsed });
    expect(useDataStore.getState().matchedRows).toBe(25);

    useDataStore.getState().clearFilterSummary();

    expect(useDataStore.getState().matchedRows).toBe(summaryPayload.rowsParsed);
  });
});
