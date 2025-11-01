import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FONT_ID,
  DEFAULT_FONT_SIZE,
  FONT_OPTIONS,
  clampFontSize,
  getFontOption,
  getFontStack
} from './fonts';

describe('fonts constants', () => {
  it('exposes a default font option', () => {
    const defaultOption = getFontOption(DEFAULT_FONT_ID);
    expect(defaultOption.id).toBe(DEFAULT_FONT_ID);
    expect(defaultOption.stack).toBeDefined();
  });

  it('falls back to default when id is unknown', () => {
    const option = getFontOption('unknown-id');
    expect(option.id).toBe(DEFAULT_FONT_ID);
  });

  it('returns stack from helper', () => {
    const stack = getFontStack(FONT_OPTIONS[0]!.id);
    expect(stack).toBe(FONT_OPTIONS[0]!.stack);
  });

  it('clamps font size between limits', () => {
    expect(clampFontSize(8)).toBe(10);
    expect(clampFontSize(30)).toBe(24);
    expect(clampFontSize(16)).toBe(16);
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
  });
});
