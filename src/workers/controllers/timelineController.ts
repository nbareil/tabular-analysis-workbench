import { evaluateFilterOnRows } from '../filterEngine';
import type { DataWorkerStateController } from '../state/dataWorkerState';
import type { DatetimeColumnBatch } from '../types';
import { materializeRowBatch } from '../utils/materializeRowBatch';
import type {
  EventTimelineBucket,
  EventTimelineBucketFamily,
  EventTimelineRequest,
  EventTimelineResult
} from '../workerApiTypes';

export interface TimelineController {
  init(): void;
  clear(): void;
  run(request: EventTimelineRequest): Promise<EventTimelineResult>;
}

export interface TimelineControllerDeps {
  state: DataWorkerStateController;
}

interface TimelineBucketSpec {
  family: EventTimelineBucketFamily;
  step: number;
  sizeMs: number;
  alignedStart: number;
  bucketCount: number;
}

const MAX_BUCKETS = 120;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

const BUCKET_CANDIDATES: Record<EventTimelineBucketFamily, number[]> = {
  seconds: [1, 5, 10, 15, 30],
  minutes: [1, 5, 10, 15, 30],
  hours: [1, 2, 3, 6, 12, 24]
};

const FAMILY_TO_MS: Record<EventTimelineBucketFamily, number> = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000
};

const normaliseRange = (rangeStart: number, rangeEnd: number): [number, number] => {
  if (rangeStart <= rangeEnd) {
    return [rangeStart, rangeEnd];
  }

  return [rangeEnd, rangeStart];
};

export const resolveTimelineBucketSpec = (
  rangeStart: number,
  rangeEnd: number,
  focusStart?: number | null,
  focusEnd?: number | null
): TimelineBucketSpec => {
  const [normalisedStart, normalisedEnd] = normaliseRange(rangeStart, rangeEnd);
  const [focusRangeStart, focusRangeEnd] =
    typeof focusStart === 'number' &&
    Number.isFinite(focusStart) &&
    typeof focusEnd === 'number' &&
    Number.isFinite(focusEnd)
      ? normaliseRange(focusStart, focusEnd)
      : [normalisedStart, normalisedEnd];
  const familySpanMs = Math.max(0, focusRangeEnd - focusRangeStart);
  const displaySpanMs = Math.max(0, normalisedEnd - normalisedStart);
  const family: EventTimelineBucketFamily =
    familySpanMs <= TEN_MINUTES_MS
      ? 'seconds'
      : familySpanMs <= SEVENTY_TWO_HOURS_MS
        ? 'minutes'
        : 'hours';
  const unitMs = FAMILY_TO_MS[family];
  const candidates = BUCKET_CANDIDATES[family];
  const step =
    candidates.find((candidate) =>
      Math.ceil((displaySpanMs + unitMs) / (candidate * unitMs)) <= MAX_BUCKETS
    ) ?? candidates[candidates.length - 1]!;
  const sizeMs = step * unitMs;
  const alignedStart = Math.floor(normalisedStart / sizeMs) * sizeMs;
  const alignedEndExclusive =
    Math.floor(normalisedEnd / sizeMs) * sizeMs + sizeMs;
  const bucketCount = Math.max(
    1,
    Math.ceil((alignedEndExclusive - alignedStart) / sizeMs)
  );

  return {
    family,
    step,
    sizeMs,
    alignedStart,
    bucketCount
  };
};

const buildEmptyTimelineResult = (
  request: EventTimelineRequest,
  bucketSpec?: TimelineBucketSpec
): EventTimelineResult => ({
  requestId: request.requestId,
  column: request.column,
  rangeStart: Math.min(request.rangeStart, request.rangeEnd),
  rangeEnd: Math.max(request.rangeStart, request.rangeEnd),
  selectedStart:
    typeof request.selectedStart === 'number' && Number.isFinite(request.selectedStart)
      ? request.selectedStart
      : null,
  selectedEnd:
    typeof request.selectedEnd === 'number' && Number.isFinite(request.selectedEnd)
      ? request.selectedEnd
      : null,
  bucketFamily: bucketSpec?.family ?? 'seconds',
  bucketStep: bucketSpec?.step ?? 1,
  totalMatchingRows: 0,
  buckets: bucketSpec
    ? Array.from({ length: bucketSpec.bucketCount }, (_value, index) => {
        const start = bucketSpec.alignedStart + index * bucketSpec.sizeMs;
        return {
          start,
          end: start + bucketSpec.sizeMs,
          count: 0
        };
      })
    : []
});

export const createTimelineController = ({
  state
}: TimelineControllerDeps): TimelineController => {
  const init = (): void => {
    // No-op hook for future instrumentation
  };

  const clear = (): void => {
    // No retained state yet
  };

  const run = async (request: EventTimelineRequest): Promise<EventTimelineResult> => {
    const batchStore = state.dataset.batchStore;
    const bucketSpec = resolveTimelineBucketSpec(
      request.rangeStart,
      request.rangeEnd,
      request.selectedStart,
      request.selectedEnd
    );
    if (!batchStore) {
      return buildEmptyTimelineResult(request, bucketSpec);
    }

    const columnBatch = state.dataset.columnTypes[request.column];
    if (columnBatch !== 'datetime') {
      return buildEmptyTimelineResult(request, bucketSpec);
    }

    const [normalisedStart, normalisedEnd] = normaliseRange(
      request.rangeStart,
      request.rangeEnd
    );
    const counts = new Array<number>(bucketSpec.bucketCount).fill(0);
    let totalMatchingRows = 0;

    for await (const { batch } of batchStore.iterateBatches()) {
      const datetimeColumn = batch.columns[request.column];
      if (!datetimeColumn || datetimeColumn.type !== 'datetime') {
        continue;
      }

      let matches: Uint8Array | null = null;
      if (request.expression) {
        const materializedRows = materializeRowBatch(batch).rows;
        matches = evaluateFilterOnRows(
          materializedRows,
          state.dataset.columnTypes,
          request.expression,
          {
            tags: state.tagging.tags
          }
        ).matches;
      }

      const datetimeValues = (datetimeColumn as DatetimeColumnBatch).data;
      const nullMask = datetimeColumn.nullMask;

      for (let index = 0; index < datetimeValues.length; index += 1) {
        if (matches && matches[index] !== 1) {
          continue;
        }

        if (nullMask && nullMask[index] === 1) {
          continue;
        }

        const timestamp = datetimeValues[index];
        if (!Number.isFinite(timestamp)) {
          continue;
        }

        if (timestamp < normalisedStart || timestamp > normalisedEnd) {
          continue;
        }

        const bucketIndex = Math.min(
          bucketSpec.bucketCount - 1,
          Math.max(
            0,
            Math.floor((timestamp - bucketSpec.alignedStart) / bucketSpec.sizeMs)
          )
        );
        counts[bucketIndex] += 1;
        totalMatchingRows += 1;
      }
    }

    const buckets: EventTimelineBucket[] = counts.map((count, index) => {
      const start = bucketSpec.alignedStart + index * bucketSpec.sizeMs;
      return {
        start,
        end: start + bucketSpec.sizeMs,
        count
      };
    });

    return {
      requestId: request.requestId,
      column: request.column,
      rangeStart: normalisedStart,
      rangeEnd: normalisedEnd,
      selectedStart:
        typeof request.selectedStart === 'number' && Number.isFinite(request.selectedStart)
          ? request.selectedStart
          : null,
      selectedEnd:
        typeof request.selectedEnd === 'number' && Number.isFinite(request.selectedEnd)
          ? request.selectedEnd
          : null,
      bucketFamily: bucketSpec.family,
      bucketStep: bucketSpec.step,
      totalMatchingRows,
      buckets
    };
  };

  return {
    init,
    clear,
    run
  };
};
