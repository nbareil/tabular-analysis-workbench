/** Trims and NFC-normalises text, lowercasing it unless the comparison is case sensitive. */
export const normalizeString = (value: string, caseSensitive: boolean): string => {
  const normalized = value.trim().normalize('NFC');
  return caseSensitive ? normalized : normalized.toLowerCase();
};
