import { describe, expect, it } from 'vitest';

import { formatDatetimeForDisplay } from './datetimeFormat';

describe('formatDatetimeForDisplay', () => {
  it('keeps the original text when asked to', () => {
    expect(formatDatetimeForDisplay('2024-01-01 10:00:00', 'original')).toBe('2024-01-01 10:00:00');
  });

  it('treats naive timestamps as UTC and converts them to the chosen zone', () => {
    expect(formatDatetimeForDisplay('2024-01-01 10:00:00', 'UTC')).toBe('2024-01-01 10:00:00.000 UTC');
    expect(formatDatetimeForDisplay('2024-07-01T10:00:00Z', 'Europe/Paris')).toBe(
      '2024-07-01 12:00:00.000 UTC+2'
    );
  });

  it('leaves unparseable text alone', () => {
    expect(formatDatetimeForDisplay('not a date', 'UTC')).toBe('not a date');
  });
});
