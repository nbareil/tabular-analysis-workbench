import { parseDatetime } from '@workers/valueParsing';
import type { DisplayTimeZone } from '@state/appStore';

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      timeZoneName: 'shortOffset'
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/** Lists the time zones offered for display, with the analyst's own zone first after UTC. */
export const availableTimeZones = (): string[] => {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return Array.from(new Set(['UTC', local, ...all]));
};

/**
 * Renders a datetime cell in the chosen zone as `YYYY-MM-DD HH:mm:ss.SSS ±offset`.
 * Text that does not parse, and the `original` setting, show the file's text unchanged.
 */
export const formatDatetimeForDisplay = (raw: string, timeZone: DisplayTimeZone): string => {
  if (timeZone === 'original') {
    return raw;
  }
  const millis = parseDatetime(raw);
  if (millis == null) {
    return raw;
  }
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(millis))
      .map((part) => [part.type, part.value])
  );
  const zoneName = parts.timeZoneName ?? '';
  const offset = /^GMT([+-]0)?$/.test(zoneName) ? 'UTC' : zoneName.replace('GMT', 'UTC');
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond} ${offset}`;
};
