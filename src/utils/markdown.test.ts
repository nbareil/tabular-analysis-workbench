import { describe, expect, it } from 'vitest';

import { renderMarkdownToSafeHtml } from '@utils/markdown';

describe('renderMarkdownToSafeHtml', () => {
  it('renders basic markdown to HTML', () => {
    const html = renderMarkdownToSafeHtml('**Hello** _world_');

    expect(html).toContain('<strong>Hello</strong>');
    expect(html).toContain('<em>world</em>');
  });

  it('strips unsafe script tags', () => {
    const html = renderMarkdownToSafeHtml('Text <script>alert("boom")</script>');

    expect(html).not.toContain('<script');
    expect(html).toContain('Text');
  });

  it('removes javascript URLs from links', () => {
    const html = renderMarkdownToSafeHtml('[click me](javascript:alert("boom"))');

    expect(html).not.toContain('javascript:');
    expect(html).toContain('<a');
  });

  it('returns empty string when markdown is empty', () => {
    expect(renderMarkdownToSafeHtml('')).toBe('');
    expect(renderMarkdownToSafeHtml(undefined)).toBe('');
    expect(renderMarkdownToSafeHtml(null)).toBe('');
  });
});
