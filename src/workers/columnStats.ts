import type { RowBatchStore } from './rowBatchStore';
import type { ColumnType } from './types';
import type { ColumnProfile, TimeHistogramResult } from './workerApiTypes';
import { parseBoolean, parseDatetime, parseNumber } from './valueParsing';

const DISTINCT_CAP = 100_000;
const TOP_VALUES = 10;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const comparable = (type: ColumnType, raw: string): number | string | null => {
  switch (type) {
    case 'number':
      return parseNumber(raw);
    case 'datetime':
      return parseDatetime(raw);
    case 'boolean': {
      const value = parseBoolean(raw);
      return value == null ? null : Number(value);
    }
    default:
      return raw;
  }
};

const isLess = (left: number | string, right: number | string): boolean =>
  typeof left === 'number' && typeof right === 'number' ? left < right : collator.compare(String(left), String(right)) < 0;

/** Summarises one column over the rows selected by `rowMask` (all rows when null). */
export const profileColumn = async (
  store: RowBatchStore,
  rowMask: Uint8Array | null,
  column: string,
  type: ColumnType
): Promise<ColumnProfile> => {
  const counts = new Map<string, number>();
  let rows = 0;
  let emptyCount = 0;
  let invalidCount = 0;
  let distinctCapped = false;
  let min: { key: number | string; raw: string } | null = null;
  let max: { key: number | string; raw: string } | null = null;
  let sum = 0;
  let numericCount = 0;
  let minLength = Number.POSITIVE_INFINITY;
  let maxLength = 0;

  for await (const view of store.iterateBatches()) {
    const values = view.column(column);
    for (let index = 0; index < view.rowCount; index += 1) {
      if (rowMask && rowMask[view.rowStart + index] !== 1) {
        continue;
      }
      rows += 1;
      const raw = values[index]!;
      if (raw.trim() === '') {
        emptyCount += 1;
        continue;
      }
      minLength = Math.min(minLength, raw.length);
      maxLength = Math.max(maxLength, raw.length);

      const count = counts.get(raw);
      if (count != null) {
        counts.set(raw, count + 1);
      } else if (counts.size < DISTINCT_CAP) {
        counts.set(raw, 1);
      } else {
        distinctCapped = true;
      }

      const key = comparable(type, raw);
      if (key == null) {
        invalidCount += 1;
        continue;
      }
      if (type === 'number') {
        sum += key as number;
        numericCount += 1;
      }
      if (!min || isLess(key, min.key)) {
        min = { key, raw };
      }
      if (!max || isLess(max.key, key)) {
        max = { key, raw };
      }
    }
  }

  const topValues = Array.from(counts, ([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, TOP_VALUES);

  return {
    column,
    type,
    rows,
    emptyCount,
    invalidCount,
    distinctCount: counts.size,
    distinctCapped,
    min: min?.raw ?? null,
    max: max?.raw ?? null,
    mean: numericCount > 0 ? sum / numericCount : null,
    minLength: Number.isFinite(minLength) ? minLength : 0,
    maxLength,
    topValues
  };
};

/** Counts datetime values per equal-width bucket between the earliest and latest value. */
export const timeHistogram = async (
  store: RowBatchStore,
  rowMask: Uint8Array | null,
  column: string,
  buckets: number
): Promise<TimeHistogramResult> => {
  const times: number[] = [];
  for await (const view of store.iterateBatches()) {
    const values = view.column(column);
    for (let index = 0; index < view.rowCount; index += 1) {
      if (rowMask && rowMask[view.rowStart + index] !== 1) {
        continue;
      }
      const time = parseDatetime(values[index]!);
      if (time != null) {
        times.push(time);
      }
    }
  }

  if (!times.length) {
    return { column, start: null, bucketMs: 0, counts: [], datedRows: 0 };
  }

  let start = times[0]!;
  let end = start;
  for (const time of times) {
    if (time < start) {
      start = time;
    }
    if (time > end) {
      end = time;
    }
  }
  const bucketMs = Math.max(1, Math.ceil((end - start + 1) / buckets));
  const counts = new Array<number>(buckets).fill(0);
  for (const time of times) {
    counts[Math.min(buckets - 1, Math.floor((time - start) / bucketMs))]! += 1;
  }
  return { column, start, bucketMs, counts, datedRows: times.length };
};
