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

// Links in notes open in a new tab so following one never navigates away from the loaded dataset.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

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
