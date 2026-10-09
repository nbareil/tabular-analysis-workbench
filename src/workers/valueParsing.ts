import type { ColumnType } from './types';

/**
 * Strict parsers shared by type inference and the query engines.
 * Cells are always stored as raw text; these turn that text into typed values on demand.
 * Anything that does not parse returns null and is treated as missing for typed semantics.
 */

const NUMBER_REGEX = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export const parseNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!NUMBER_REGEX.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

const BOOLEAN_TRUE = new Set(['true', 't', 'yes', 'y']);
const BOOLEAN_FALSE = new Set(['false', 'f', 'no', 'n']);

export const parseBoolean = (raw: string): boolean | null => {
  const lower = raw.trim().toLowerCase();
  if (BOOLEAN_TRUE.has(lower)) {
    return true;
  }
  if (BOOLEAN_FALSE.has(lower)) {
    return false;
  }
  return null;
};

// YYYY-MM-DD or YYYY/MM/DD, optional [T ]HH:MM[:SS[.fraction]], optional zone.
// Timestamps without a zone are interpreted as UTC so results never depend on the analyst's machine.
const DATETIME_REGEX =
  /^(\d{4})([-/])(\d{2})\2(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?$/i;
const EPOCH_REGEX = /^\d{10}(?:\d{3})?$/;
// Epoch values are only accepted between 2000-01-01 and 2100-01-01 to avoid treating ids as dates.
const EPOCH_MIN_SECONDS = 946_684_800;
const EPOCH_MAX_SECONDS = 4_102_444_800;

const parseZoneOffsetMinutes = (zone: string | undefined): number => {
  if (!zone || /^(z|utc|gmt)$/i.test(zone)) {
    return 0;
  }
  const sign = zone.startsWith('-') ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  return sign * (hours * 60 + minutes);
};

export const parseDatetime = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (EPOCH_REGEX.test(trimmed)) {
    const seconds = trimmed.length === 10 ? Number(trimmed) : Number(trimmed) / 1_000;
    return seconds >= EPOCH_MIN_SECONDS && seconds < EPOCH_MAX_SECONDS ? seconds * 1_000 : null;
  }

  const match = DATETIME_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }

  const [, y, , mo, d, h = '0', mi = '0', s = '0', fraction = '', zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(utc).getUTCDate() !== day) {
    return null;
  }

  // Sub-millisecond digits are kept as a fractional part so microsecond timelines still order correctly.
  const fractionMillis = fraction ? Number(`0.${fraction}`) * 1_000 : 0;
  return utc + fractionMillis - parseZoneOffsetMinutes(zone) * 60_000;
};

/** Parses raw text into the comparable value for a column type; strings stay strings. */
export const parseTypedValue = (
  type: ColumnType,
  raw: string
): number | boolean | string | null => {
  switch (type) {
    case 'number':
      return parseNumber(raw);
    case 'datetime':
      return parseDatetime(raw);
    case 'boolean':
      return parseBoolean(raw);
    default:
      return raw;
  }
};

/** Formats epoch milliseconds as ISO 8601 UTC, dropping a zero millisecond part. */
export const formatUtcIso = (millis: number): string =>
  new Date(millis).toISOString().replace('.000Z', 'Z');
