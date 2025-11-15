import { describe, expect, it, beforeEach } from 'vitest';

import { reportAppError } from './diagnostics';
import { useDataStore } from '@state/dataStore';

describe('reportAppError', () => {
  beforeEach(() => {
    useDataStore.setState((state) => ({
      ...state,
      message: null,
      errorDetails: null,
      status: 'idle'
    }));
  });

  it('stores diagnostic payload with context and retry metadata', () => {
    const retry = () => Promise.resolve();
    reportAppError('Failed to fetch rows', new Error('boom'), {
      operation: 'grid.fetch',
      context: { offset: 0, limit: 100 },
      retry
    });

    const details = useDataStore.getState().errorDetails;
    expect(details).not.toBeNull();
    expect(details?.message).toBe('Failed to fetch rows');
    expect(details?.payload).toMatchObject({
      operation: 'grid.fetch',
      context: { offset: 0, limit: 100 },
      retry
    });
  });

  it('handles non-error payloads gracefully', () => {
    reportAppError('Something odd happened', 'string error');
    expect(useDataStore.getState().errorDetails?.message).toBe('Something odd happened');
  });
});
