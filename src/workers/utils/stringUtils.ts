/**
 * Copies a string that outlives the text it was sliced from. V8 keeps the whole parent string
 * alive as long as any slice of it lives, so a few kept slices could pin every decoded chunk.
 */
export const detachString = (value: string): string => ` ${value}`.slice(1);

/** Trims and NFC-normalises text, lowercasing it unless the comparison is case sensitive. */
export const normalizeString = (value: string, caseSensitive: boolean): string => {
  const normalized = value.trim().normalize('NFC');
  return caseSensitive ? normalized : normalized.toLowerCase();
};
