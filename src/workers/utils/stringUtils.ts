/**
 * Normalizes a value to string with optional case sensitivity.
 * Converts the value to string and optionally lowercases it.
 */
export const normalizeValue = (value: unknown, caseSensitive: boolean): string => {
  const stringValue = String(value ?? '');
  return caseSensitive ? stringValue : stringValue.toLowerCase();
};

/**
 * Normalizes a string with optional case sensitivity.
 * Optionally lowercases the string.
 */
export const normalizeString = (value: string, caseSensitive: boolean): string => {
  return caseSensitive ? value : value.toLowerCase();
};
