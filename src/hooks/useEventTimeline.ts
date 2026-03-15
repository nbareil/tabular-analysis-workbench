import { useEffect, useRef, useState } from 'react';

import { getDataWorker, type EventTimelineResult } from '@workers/dataWorkerProxy';
import { reportAppError } from '@utils/diagnostics';
import type { ResolvedEventTimelineConfig } from '@utils/eventTimeline';

const TIMELINE_DEBOUNCE_MS = 150;

export interface UseEventTimelineResult {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: EventTimelineResult | null;
  error: string | null;
}

export const useEventTimeline = ({
  enabled,
  config
}: {
  enabled: boolean;
  config: ResolvedEventTimelineConfig | null;
}): UseEventTimelineResult => {
  const requestIdRef = useRef(0);
  const [result, setResult] = useState<UseEventTimelineResult>({
    status: 'idle',
    data: null,
    error: null
  });

  useEffect(() => {
    if (!enabled || !config) {
      requestIdRef.current += 1;
      setResult({
        status: 'idle',
        data: null,
        error: null
      });
      return undefined;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setResult((previous) => ({
      status: 'loading',
      data: previous.data,
      error: null
    }));

    const timeout = window.setTimeout(async () => {
      try {
        const worker = getDataWorker();
        const response = await worker.getEventTimeline({
          requestId,
          column: config.column,
          expression: config.expression,
          rangeStart: config.rangeStart,
          rangeEnd: config.rangeEnd,
          selectedStart: config.selectedStart,
          selectedEnd: config.selectedEnd
        });
        if (requestId !== requestIdRef.current) {
          return;
        }

        setResult({
          status: 'ready',
          data: response,
          error: null
        });
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setResult({
          status: 'error',
          data: null,
          error: message
        });
        reportAppError('Failed to compute event timeline', error, {
          operation: 'timeline.compute',
          context: {
            column: config.column
          }
        });
      }
    }, TIMELINE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [config, enabled]);

  return result;
};
