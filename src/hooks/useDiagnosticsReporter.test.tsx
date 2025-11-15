import { render, cleanup } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { useDiagnosticsReporter } from './useDiagnosticsReporter';
import { useDataStore } from '@state/dataStore';

const TestComponent = () => {
  useDiagnosticsReporter();
  return null;
};

describe('useDiagnosticsReporter', () => {
  beforeEach(() => {
    useDataStore.setState((state) => ({
      ...state,
      message: null,
      errorDetails: null
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it('captures window errors and unhandled rejections', () => {
    render(<TestComponent />);

    const errorEvent = new ErrorEvent('error', {
      message: 'Boom',
      error: new Error('Boom')
    });
    window.dispatchEvent(errorEvent);
    expect(useDataStore.getState().errorDetails?.message).toBe('Boom');

    const rejectedPromise = Promise.reject(new Error('Rejected'));
    void rejectedPromise.catch(() => {});
    const rejectionEvent = new PromiseRejectionEvent('unhandledrejection', {
      promise: rejectedPromise,
      reason: new Error('Rejected')
    });
    window.dispatchEvent(rejectionEvent);
    expect(useDataStore.getState().errorDetails?.message).toBe('Unhandled promise rejection');
  });
});
