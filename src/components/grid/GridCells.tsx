import { type JSX, useRef } from 'react';
import type { ICellRendererParams, IHeaderParams } from 'ag-grid-community';

import type { TagCellValue, TagLabelView } from '@utils/tagCells';
import { renderMarkdownToSafeHtml } from '@utils/markdown';
import { isTagCellValue } from './gridUtils';

export interface DataGridHeaderParams extends IHeaderParams {
  openHeaderMenu: (columnId: string, anchorRect: DOMRect) => void;
}

export const DataGridHeader = ({
  column,
  displayName,
  enableSorting,
  progressSort,
  openHeaderMenu
}: DataGridHeaderParams): JSX.Element => {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const columnId = typeof column?.getColId === 'function' ? column.getColId() : '';
  const sortDirection = typeof column?.getSort === 'function' ? column.getSort() : null;

  return (
    <div className="flex h-full min-w-0 items-center gap-2 pr-1">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden bg-transparent text-left text-inherit"
        onClick={(event) => {
          if (!enableSorting || typeof progressSort !== 'function') {
            return;
          }

          progressSort(event.shiftKey);
        }}
      >
        <span className="truncate">{displayName}</span>
        {sortDirection === 'asc' ? <span aria-hidden>↑</span> : null}
        {sortDirection === 'desc' ? <span aria-hidden>↓</span> : null}
      </button>
      <button
        ref={menuButtonRef}
        type="button"
        aria-label={`Open ${displayName} menu`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-slate-500 hover:bg-slate-200/10 hover:text-slate-200"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();

          if (!columnId || !menuButtonRef.current) {
            return;
          }

          openHeaderMenu(columnId, menuButtonRef.current.getBoundingClientRect());
        }}
      >
        ☰
      </button>
    </div>
  );
};

export const TagCellRenderer = ({
  value
}: ICellRendererParams<TagCellValue | null>): JSX.Element => {
  if (!value) {
    return (
      <span className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-400 dark:border-slate-600"
          aria-hidden
        />
        Add label
      </span>
    );
  }

  const note = value.note;
  const primaryLabel = value.labels[0];
  const extraCount = Math.max(0, value.labels.length - 1);
  const text = primaryLabel?.name ?? (note ? 'No label' : 'Tagged');

  return (
    <span className="flex items-center gap-2 truncate text-xs text-slate-900 dark:text-slate-100">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={
          primaryLabel?.color
            ? { backgroundColor: primaryLabel.color }
            : { border: '1px solid rgb(71 85 105)', backgroundColor: 'transparent' }
        }
        aria-hidden
      />
      <span className="truncate">{text}</span>
      {extraCount > 0 ? (
        <span className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-400">
          +{extraCount} more
        </span>
      ) : null}
      {note ? (
        <span className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Note
        </span>
      ) : null}
    </span>
  );
};

export const MarkdownTooltip = ({
  value
}: ICellRendererParams<TagCellValue | null>): JSX.Element | null => {
  if (!isTagCellValue(value)) {
    return null;
  }

  const { labels, note } = value;

  if (note) {
    const html = renderMarkdownToSafeHtml(note);
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  if (labels.length > 0) {
    return <div>{labels.map((label: TagLabelView) => label.name).join(', ')}</div>;
  }

  return null;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Renders cell text with every occurrence of the active search query highlighted. */
export const HighlightCell = ({
  value,
  valueFormatted,
  query,
  caseSensitive
}: ICellRendererParams & { query: string; caseSensitive: boolean }): JSX.Element => {
  const text = valueFormatted ?? (value == null ? '' : String(value));
  const needle = query.trim();
  if (!needle) {
    return <>{text}</>;
  }
  // Matching on the original text (not a lowercased copy) keeps indexes right for characters
  // whose lowercase form has a different length, such as "İ".
  const pattern = new RegExp(escapeRegExp(needle), caseSensitive ? 'gu' : 'giu');
  const pieces: JSX.Element[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    if (index > cursor) {
      pieces.push(<span key={`t${cursor}`}>{text.slice(cursor, index)}</span>);
    }
    pieces.push(
      <mark key={`m${index}`} className="rounded-xs bg-amber-300/70 text-inherit">
        {match[0]}
      </mark>
    );
    cursor = index + match[0].length;
  }
  pieces.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>);
  return <>{pieces}</>;
};
