import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ColumnValueDistributionResult, LoadCompleteSummary } from '@workers/workerApiTypes';

const mockGetColumnValueDistribution = vi.fn();

vi.mock('@workers/dataWorkerProxy', async () => {
  const actual = await vi.importActual<typeof import('@workers/dataWorkerProxy')>('@workers/dataWorkerProxy');
  return {
    ...actual,
    getDataWorker: () => ({ getColumnValueDistribution: mockGetColumnValueDistribution })
  };
});

import { useDataStore } from './dataStore';

const summary: LoadCompleteSummary = {
  rowsParsed: 100,
  bytesParsed: 1024,
  malformedRows: 0,
  durationMs: 500,
  columnTypes: { alpha: 'string' },
  columnInference: {
    alpha: { confidence: 0.9, samples: 100, nullCount: 0, examples: ['foo', 'bar'], type: 'string' }
  }
};

const distribution = (column: string): ColumnValueDistributionResult => ({
  column,
  totalRows: 100,
  nonNullRows: 90,
  distinctCount: 2,
  skipped: false,
  items: [{ value: 'foo', count: 80 }]
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('useDataStore', () => {
  beforeEach(() => {
    mockGetColumnValueDistribution.mockReset();
    useDataStore.getState().startLoading('data.csv');
    useDataStore.getState().setHeader(['alpha']);
    useDataStore.getState().complete(summary);
  });

  describe('loading lifecycle', () => {
    it('startLoading bumps loadId and clears the previous file', () => {
      const before = useDataStore.getState();
      useDataStore.getState().setFilterSummary({ matchedRows: 5, totalRows: 100 });

      useDataStore.getState().startLoading('next.csv');

      const state = useDataStore.getState();
      expect(state.loadId).toBe(before.loadId + 1);
      expect(state.viewVersion).toBeGreaterThan(before.viewVersion);
      expect(state.status).toBe('loading');
      expect(state.fileName).toBe('next.csv');
      expect(state.columns).toEqual([]);
      expect(state.filterActive).toBe(false);
      expect(state.matchedRows).toBeNull();
    });

    it('complete applies inferred column types and confidence percent', () => {
      const state = useDataStore.getState();
      expect(state.status).toBe('ready');
      expect(state.totalRows).toBe(100);
      expect(state.matchedRows).toBe(100);
      expect(state.columns[0]).toMatchObject({ key: 'alpha', type: 'string', confidence: 90 });
      expect(state.message).toMatch(/Loaded 100 rows/);
    });

    it('complete mentions malformed rows', () => {
      useDataStore.getState().complete({ ...summary, malformedRows: 3 });
      expect(useDataStore.getState().message).toMatch(/3 rows had the wrong number of fields/);
    });

    it('setError records details without changing the load status', () => {
      useDataStore.getState().setError('boom', new Error('inner'));
      const state = useDataStore.getState();
      expect(state.status).toBe('ready');
      expect(state.errorDetails).toMatchObject({ message: 'boom', payload: { originalMessage: 'inner' } });

      useDataStore.getState().clearError();
      expect(useDataStore.getState().errorDetails).toBeNull();
    });

    it('failLoading sets the error status', () => {
      useDataStore.getState().failLoading('could not parse');
      expect(useDataStore.getState().status).toBe('error');
      expect(useDataStore.getState().message).toBe('could not parse');
    });

    it('keeps the filtered count while progress streams in for an active filter', () => {
      useDataStore.getState().startLoading('stream.csv');
      useDataStore.getState().setFilterSummary({ matchedRows: 3, totalRows: 0 });
      useDataStore.getState().reportProgress({ rowsParsed: 50, bytesParsed: 10 });
      expect(useDataStore.getState().totalRows).toBe(50);
      expect(useDataStore.getState().matchedRows).toBe(3);
    });
  });

  describe('filter and search summaries', () => {
    it('stores and clears filter summary and per-filter match counts', () => {
      useDataStore.getState().setFilterSummary({ matchedRows: 25, totalRows: 100, filterMatchCounts: { a: 10 } });
      expect(useDataStore.getState()).toMatchObject({
        matchedRows: 25,
        filterActive: true,
        filterPredicateMatchCounts: { a: 10 }
      });

      useDataStore.getState().clearFilterSummary(100);
      expect(useDataStore.getState()).toMatchObject({
        matchedRows: 100,
        filterActive: false,
        filterPredicateMatchCounts: null,
        didYouMean: null
      });
    });

    it('clearSearchResult keeps the current count unless given one', () => {
      useDataStore.getState().setSearchResult({ totalRows: 100, matchedRows: 7 });
      expect(useDataStore.getState().searchActive).toBe(true);

      useDataStore.getState().clearSearchResult();
      expect(useDataStore.getState()).toMatchObject({ searchActive: false, matchedRows: 7 });

      useDataStore.getState().clearSearchResult(100);
      expect(useDataStore.getState().matchedRows).toBe(100);
    });
  });

  describe('navigateGrid', () => {
    it('gives each request a new sequence number', () => {
      useDataStore.getState().navigateGrid({ kind: 'next' });
      const first = useDataStore.getState().navigation!;
      useDataStore.getState().navigateGrid({ kind: 'next' });
      const second = useDataStore.getState().navigation!;
      expect(second.kind).toBe('next');
      expect(second.seq).toBeGreaterThan(first.seq);

      useDataStore.getState().navigateGrid({ kind: 'row', rowId: 12 });
      expect(useDataStore.getState().navigation).toMatchObject({ kind: 'row', rowId: 12 });
    });
  });

  describe('loadColumnValueDistribution', () => {
    it('loads and caches a distribution', async () => {
      mockGetColumnValueDistribution.mockResolvedValue(distribution('alpha'));

      const pending = useDataStore.getState().loadColumnValueDistribution('alpha');
      expect(useDataStore.getState().columnValueDistributions.alpha).toEqual({ status: 'loading' });
      await pending;

      expect(useDataStore.getState().columnValueDistributions.alpha).toEqual({
        status: 'ready',
        result: distribution('alpha')
      });
      expect(mockGetColumnValueDistribution).toHaveBeenCalledWith({ column: 'alpha' });
    });

    it('dedupes concurrent and repeated requests for the same column', async () => {
      const request = deferred<ColumnValueDistributionResult>();
      mockGetColumnValueDistribution.mockReturnValue(request.promise);

      const first = useDataStore.getState().loadColumnValueDistribution('alpha');
      const second = useDataStore.getState().loadColumnValueDistribution('alpha');
      request.resolve(distribution('alpha'));
      await Promise.all([first, second]);
      await useDataStore.getState().loadColumnValueDistribution('alpha');

      expect(mockGetColumnValueDistribution).toHaveBeenCalledTimes(1);
    });

    it('records errors and retries after a failure', async () => {
      mockGetColumnValueDistribution.mockRejectedValueOnce(new Error('worker down'));
      await useDataStore.getState().loadColumnValueDistribution('alpha');
      expect(useDataStore.getState().columnValueDistributions.alpha).toEqual({
        status: 'error',
        error: 'worker down'
      });

      mockGetColumnValueDistribution.mockResolvedValueOnce(distribution('alpha'));
      await useDataStore.getState().loadColumnValueDistribution('alpha');
      expect(useDataStore.getState().columnValueDistributions.alpha?.status).toBe('ready');
      expect(mockGetColumnValueDistribution).toHaveBeenCalledTimes(2);
    });

    it('discards results that arrive after another file was opened', async () => {
      const request = deferred<ColumnValueDistributionResult>();
      mockGetColumnValueDistribution.mockReturnValue(request.promise);

      const pending = useDataStore.getState().loadColumnValueDistribution('alpha');
      useDataStore.getState().startLoading('other.csv');
      request.resolve(distribution('alpha'));
      await pending;

      expect(useDataStore.getState().columnValueDistributions).toEqual({});
    });

    it('clears cached distributions when a load completes or the store resets', async () => {
      mockGetColumnValueDistribution.mockResolvedValue(distribution('alpha'));
      await useDataStore.getState().loadColumnValueDistribution('alpha');

      useDataStore.getState().complete(summary);
      expect(useDataStore.getState().columnValueDistributions).toEqual({});

      await useDataStore.getState().loadColumnValueDistribution('alpha');
      useDataStore.getState().reset();
      expect(useDataStore.getState().columnValueDistributions).toEqual({});
    });
  });

  describe('grouping', () => {
    it('tracks loading, result and error states', () => {
      useDataStore.getState().setGroupingLoading();
      expect(useDataStore.getState().grouping.status).toBe('loading');

      useDataStore.getState().setGroupingResult({ rows: [], groupBy: ['alpha'], totalGroups: 0, totalRows: 0 });
      expect(useDataStore.getState().grouping).toMatchObject({ status: 'ready', groupBy: ['alpha'] });

      useDataStore.getState().setGroupingError('nope');
      expect(useDataStore.getState().grouping).toMatchObject({ status: 'error', error: 'nope', groupBy: [] });

      useDataStore.getState().clearGrouping();
      expect(useDataStore.getState().grouping.status).toBe('idle');
    });
  });
});
