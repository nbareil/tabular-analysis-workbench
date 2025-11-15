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

  it('records marks and measures when available', () => {
    const mark = vi.fn();
    const measure = vi.fn();
    const clearMarks = vi.fn();
    (globalThis as any).performance = {
      mark,
      measure,
      clearMarks
    } as unknown as Performance;

    const stop = startPerformanceMeasure('phase');
    expect(mark).toHaveBeenCalledWith('phase-start');
    stop?.();
    expect(mark).toHaveBeenCalledWith('phase-end');
    expect(measure).toHaveBeenCalledWith('phase', 'phase-start', 'phase-end');
    expect(clearMarks).toHaveBeenCalledWith('phase-start');
  });
});
