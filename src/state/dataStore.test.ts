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

  it('stores and clears per-filter match counts with the summary lifecycle', () => {
    const filterMatchCounts = { alpha: 10, beta: 0 };
    useDataStore
      .getState()
      .setFilterSummary({
        matchedRows: 25,
        totalRows: summaryPayload.rowsParsed,
        filterMatchCounts
      });

    expect(useDataStore.getState().filterPredicateMatchCounts).toEqual(filterMatchCounts);

    useDataStore.getState().clearFilterSummary();

    expect(useDataStore.getState().filterPredicateMatchCounts).toBeNull();
  });

  it('stores column value distributions and clears them on reset', () => {
    useDataStore.getState().setColumnValueDistributionLoading('alpha');
    expect(useDataStore.getState().columnValueDistributions.alpha).toEqual({
      status: 'loading'
    });

    useDataStore.getState().setColumnValueDistributionResult({
      column: 'alpha',
      totalRows: 100,
      nonNullRows: 90,
      distinctCount: 2,
      skipped: false,
      defaultSort: 'desc',
      items: [{ value: 'foo', count: 80 }]
    });

    expect(useDataStore.getState().columnValueDistributions.alpha?.status).toBe('ready');

    useDataStore.getState().reset();

    expect(useDataStore.getState().columnValueDistributions).toEqual({});
  });

  it('tracks value frequency indexing progress and completion', () => {
    useDataStore.getState().startValueFrequencyIndexing(3);

    expect(useDataStore.getState().valueFrequencyIndexing).toEqual({
      status: 'indexing',
      totalColumns: 3,
      completedColumns: 0
    });

    useDataStore.getState().setValueFrequencyIndexingProgress(2);

    expect(useDataStore.getState().valueFrequencyIndexing).toEqual({
      status: 'indexing',
      totalColumns: 3,
      completedColumns: 2
    });

    useDataStore.getState().completeValueFrequencyIndexing();

    expect(useDataStore.getState().valueFrequencyIndexing).toEqual({
      status: 'ready',
      totalColumns: 3,
      completedColumns: 3
    });
  });

  it('resets value frequency indexing state on a new load', () => {
    useDataStore.getState().startValueFrequencyIndexing(2);
    useDataStore.getState().setValueFrequencyIndexingProgress(1);

    useDataStore.getState().startLoading('next.csv');

    expect(useDataStore.getState().valueFrequencyIndexing).toEqual({
      status: 'idle',
      totalColumns: 0,
      completedColumns: 0
    });
  });

  it('clears cached value distributions when a new load completes', () => {
    useDataStore.getState().setColumnValueDistributionResult({
      column: 'alpha',
      totalRows: 100,
      nonNullRows: 90,
      distinctCount: 2,
      skipped: false,
      defaultSort: 'desc',
      items: [{ value: 'foo', count: 80 }]
    });

    expect(useDataStore.getState().columnValueDistributions.alpha?.status).toBe('ready');

    useDataStore.getState().complete(summaryPayload);

    expect(useDataStore.getState().columnValueDistributions).toEqual({});
    expect(useDataStore.getState().valueFrequencyIndexing).toEqual({
      status: 'idle',
      totalColumns: 0,
      completedColumns: 0
    });
  });
});
