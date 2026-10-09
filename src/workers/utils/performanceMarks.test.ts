import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startPerformanceMeasure } from './performanceMarks';

describe('startPerformanceMeasure', () => {
  const originalPerformance = globalThis.performance;

  beforeEach(() => {
    globalThis.performance = originalPerformance;
  });

  afterEach(() => {
    globalThis.performance = originalPerformance;
  });

  it('returns null when performance is not available', () => {
    (globalThis as any).performance = undefined;
    expect(startPerformanceMeasure('phase')).toBeNull();
  });

  it('records overlapping measures of the same label independently', () => {
    const stopFirst = startPerformanceMeasure('overlap-test');
    const stopSecond = startPerformanceMeasure('overlap-test');
    stopSecond?.();
    stopFirst?.();
    expect(performance.getEntriesByName('overlap-test', 'measure')).toHaveLength(2);
  });
});
