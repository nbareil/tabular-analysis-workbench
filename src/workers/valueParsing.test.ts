import { describe, expect, it } from 'vitest';

import { formatUtcIso, parseBoolean, parseDatetime, parseNumber, parseTypedValue } from './valueParsing';

describe('parseNumber', () => {
  it.each([
    ['42', 42],
    [' -3.5 ', -3.5],
    ['+.5', 0.5],
    ['1e3', 1000],
    ['7.', 7]
  ])('parses %j', (raw, expected) => {
    expect(parseNumber(raw)).toBe(expected);
  });

  it.each(['0x1F', 'Infinity', '-Infinity', 'NaN', '1,000', '', '  ', '12abc', '1e999'])(
    'rejects %j',
    (raw) => {
      expect(parseNumber(raw)).toBeNull();
    }
  );
});

describe('parseBoolean', () => {
  it('accepts word forms case-insensitively', () => {
    expect(parseBoolean('TRUE')).toBe(true);
    expect(parseBoolean(' yes ')).toBe(true);
    expect(parseBoolean('N')).toBe(false);
    expect(parseBoolean('false')).toBe(false);
  });

  it('does not treat 1/0 as booleans', () => {
    expect(parseBoolean('1')).toBeNull();
    expect(parseBoolean('0')).toBeNull();
    expect(parseBoolean('')).toBeNull();
  });
});

describe('parseDatetime', () => {
  it('interprets naive timestamps as UTC regardless of the machine time zone', () => {
    expect(parseDatetime('2024-03-10 12:00:00')).toBe(Date.UTC(2024, 2, 10, 12));
    expect(parseDatetime('2024-07-01T00:30')).toBe(Date.UTC(2024, 6, 1, 0, 30));
    expect(parseDatetime('2024/07/01')).toBe(Date.UTC(2024, 6, 1));
  });

  it('applies explicit zones', () => {
    const noon = Date.UTC(2024, 0, 1, 12);
    expect(parseDatetime('2024-01-01T12:00:00Z')).toBe(noon);
    expect(parseDatetime('2024-01-01T12:00:00 UTC')).toBe(noon);
    expect(parseDatetime('2024-01-01T14:00:00+02:00')).toBe(noon);
    expect(parseDatetime('2024-01-01T07:00:00-0500')).toBe(noon);
    expect(parseDatetime('2024-01-01T13:00:00+01')).toBe(noon);
  });

  it('keeps sub-millisecond precision so microsecond timestamps order correctly', () => {
    const a = parseDatetime('2024-01-01T00:00:00.000001Z')!;
    const b = parseDatetime('2024-01-01T00:00:00.000002Z')!;
    expect(a).toBeGreaterThan(Date.UTC(2024, 0, 1));
    expect(b).toBeGreaterThan(a);
    expect(parseDatetime('2024-01-01T00:00:00,250')).toBe(Date.UTC(2024, 0, 1) + 250);
  });

  it('rejects impossible dates and times', () => {
    expect(parseDatetime('2023-02-29')).toBeNull();
    expect(parseDatetime('2024-13-01')).toBeNull();
    expect(parseDatetime('2024-01-01 24:00')).toBeNull();
    expect(parseDatetime('2024-01-01 12:60')).toBeNull();
    expect(parseDatetime('2024-01/01')).toBeNull();
    expect(parseDatetime('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
  });

  it('accepts epoch seconds and milliseconds only between 2000 and 2100', () => {
    expect(parseDatetime('1700000000')).toBe(1_700_000_000_000);
    expect(parseDatetime('1700000000123')).toBe(1_700_000_000_123);
    expect(parseDatetime('0946684800')).toBe(946_684_800_000);
    expect(parseDatetime('0946684799')).toBeNull();
    expect(parseDatetime('5000000000')).toBeNull();
    expect(parseDatetime('12345')).toBeNull();
    expect(parseDatetime('123456789012')).toBeNull();
  });

  it('rejects free text', () => {
    expect(parseDatetime('yesterday')).toBeNull();
    expect(parseDatetime('')).toBeNull();
  });
});

describe('parseTypedValue', () => {
  it('dispatches on column type and keeps strings raw', () => {
    expect(parseTypedValue('number', '3')).toBe(3);
    expect(parseTypedValue('boolean', 'no')).toBe(false);
    expect(parseTypedValue('datetime', '2024-01-01')).toBe(Date.UTC(2024, 0, 1));
    expect(parseTypedValue('string', ' raw ')).toBe(' raw ');
    expect(parseTypedValue('number', 'abc')).toBeNull();
  });
});

describe('formatUtcIso', () => {
  it('formats in UTC and drops a zero millisecond part', () => {
    expect(formatUtcIso(Date.UTC(2024, 0, 2, 3, 4, 5))).toBe('2024-01-02T03:04:05Z');
    expect(formatUtcIso(Date.UTC(2024, 0, 2, 3, 4, 5, 6))).toBe('2024-01-02T03:04:05.006Z');
  });
});
