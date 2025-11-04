import { marked, type MarkedOptions } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions(
  {
    breaks: true,
    gfm: true,
    mangle: false,
    headerIds: false
  } as unknown as MarkedOptions
);

const EMPTY_HTML = '';

export const renderMarkdownToSafeHtml = (markdown: string | undefined | null): string => {
  if (!markdown) {
    return EMPTY_HTML;
  }

  const trimmed = markdown.trim();
  if (!trimmed) {
    return EMPTY_HTML;
  }

  const rendered = marked.parse(trimmed);
  if (typeof rendered !== 'string') {
    return EMPTY_HTML;
  }

  return DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
};
