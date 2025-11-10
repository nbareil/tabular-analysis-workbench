/**
 * Normalizes a value to string with optional case sensitivity.
 * Converts the value to string and optionally lowercases it.
 */
export const normalizeValue = (value: unknown, caseSensitive: boolean): string => {
  const stringValue = String(value ?? '').trim().normalize('NFC');
  return caseSensitive ? stringValue : stringValue.toLowerCase();
};

/**
 * Normalizes a string with optional case sensitivity.
 * Optionally lowercases the string.
 */
export const normalizeString = (value: string, caseSensitive: boolean): string => {
  const normalized = value.trim().normalize('NFC');
  return caseSensitive ? normalized : normalized.toLowerCase();
};
