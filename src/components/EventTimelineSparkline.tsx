import type { EventTimelineResult } from '@workers/dataWorkerProxy';

const SVG_WIDTH = 240;
const SVG_HEIGHT = 44;
const CHART_PADDING = 4;

const formatBucketLabel = (bucketStep: number, family: EventTimelineResult['bucketFamily']): string => {
  const suffix = family === 'seconds' ? 's' : family === 'minutes' ? 'm' : 'h';
  return `${bucketStep}${suffix}`;
};

const formatCount = (value: number): string => value.toLocaleString();

const buildSparklinePath = (counts: number[]): { line: string; area: string } => {
  if (!counts.length) {
    return { line: '', area: '' };
  }

  const maxCount = Math.max(...counts, 1);
  const innerWidth = SVG_WIDTH - CHART_PADDING * 2;
  const innerHeight = SVG_HEIGHT - CHART_PADDING * 2;
  const stepX = counts.length > 1 ? innerWidth / (counts.length - 1) : 0;

  const points = counts.map((count, index) => {
    const x = CHART_PADDING + index * stepX;
    const y =
      CHART_PADDING + innerHeight - (count / maxCount) * innerHeight;
    return { x, y };
  });

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const firstPoint = points[0]!;
  const lastPoint = points[points.length - 1]!;
  const baselineY = SVG_HEIGHT - CHART_PADDING;
  const area = `${line} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`;

  return { line, area };
};

const getSelectionBounds = (data: EventTimelineResult): { x: number; width: number } | null => {
  if (
    data.selectedStart == null ||
    data.selectedEnd == null ||
    data.buckets.length === 0
  ) {
    return null;
  }

  const chartStart = data.buckets[0]!.start;
  const chartEnd = data.buckets[data.buckets.length - 1]!.end;
  const duration = Math.max(1, chartEnd - chartStart);
  const selectionStart = Math.max(chartStart, Math.min(data.selectedStart, chartEnd));
  const selectionEnd = Math.max(chartStart, Math.min(data.selectedEnd, chartEnd));
  const x = ((selectionStart - chartStart) / duration) * SVG_WIDTH;
  const width = Math.max(1, ((selectionEnd - selectionStart) / duration) * SVG_WIDTH);

  return { x, width };
};

export interface EventTimelineSparklineProps {
  columnLabel: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: EventTimelineResult | null;
  error: string | null;
  emptyState: string;
}

export const EventTimelineSparkline = ({
  columnLabel,
  status,
  data,
  error,
  emptyState
}: EventTimelineSparklineProps): JSX.Element => {
  if (status === 'error') {
    return (
      <section className="border-b border-slate-800 px-4 py-2">
        <div className="flex items-center justify-between gap-3 text-xs text-rose-300">
          <span>Event timeline</span>
          <span>{error ?? 'Timeline unavailable.'}</span>
        </div>
      </section>
    );
  }

  if (status === 'idle' || !data || !data.buckets.length) {
    return (
      <section className="border-b border-slate-800 px-4 py-2">
        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>Event timeline</span>
          <span>{emptyState}</span>
        </div>
      </section>
    );
  }

  const counts = data.buckets.map((bucket) => bucket.count);
  const { line, area } = buildSparklinePath(counts);
  const selection = getSelectionBounds(data);

  return (
    <section className="border-b border-slate-800 px-4 py-2">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-200">
          <span className="font-medium">Event timeline</span>
          {columnLabel && (
            <span className="rounded bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400">
              {columnLabel}
            </span>
          )}
          {status === 'loading' && (
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Refreshing…</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <span>{formatCount(data.totalMatchingRows)} events</span>
          <span>{formatBucketLabel(data.bucketStep, data.bucketFamily)} buckets</span>
        </div>
      </div>
      <div className="overflow-hidden rounded border border-slate-800 bg-slate-950/80">
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-14 w-full">
          {selection && (
            <rect
              x={selection.x}
              y={0}
              width={selection.width}
              height={SVG_HEIGHT}
              fill="rgba(148, 163, 184, 0.14)"
            />
          )}
          <path d={area} fill="rgba(56, 189, 248, 0.14)" />
          <path
            d={line}
            fill="none"
            stroke="rgb(56, 189, 248)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </section>
  );
};
