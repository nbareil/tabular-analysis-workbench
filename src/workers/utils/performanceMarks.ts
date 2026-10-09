type PerformanceCleanup = () => void;

/**
 * Starts a `performance.measure` entry named `label` (visible in DevTools' Performance panel) and
 * returns a function that ends it. Measures carry their own start time, so overlapping runs of the
 * same label (e.g. a superseded load) never clobber each other.
 */
export const startPerformanceMeasure = (label: string): PerformanceCleanup | null => {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') {
    return null;
  }
  const start = performance.now();
  return () => {
    performance.measure(label, { start, end: performance.now() });
  };
};
