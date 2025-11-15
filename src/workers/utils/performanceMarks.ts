type PerformanceCleanup = () => void;

/**
 * Wraps performance.mark/measure calls so worker code can emit profiling data
 * without littering guards everywhere.
 */
export const startPerformanceMeasure = (label: string): PerformanceCleanup | null => {
  if (
    typeof performance === 'undefined' ||
    typeof performance.mark !== 'function' ||
    typeof performance.measure !== 'function'
  ) {
    return null;
  }

  const startMark = `${label}-start`;
  performance.mark(startMark);

  return () => {
    const endMark = `${label}-end`;

    try {
      performance.mark(endMark);
      performance.measure(label, startMark, endMark);
    } catch (error) {
      console.warn('[performance-marks] Failed to record measure', { label, error });
    } finally {
      if (typeof performance.clearMarks === 'function') {
        performance.clearMarks(startMark);
        performance.clearMarks(endMark);
      }
    }
  };
};
