/**
 * Calculates the Damerau-Levenshtein distance between two strings.
 * This distance accounts for insertions, deletions, substitutions, and transpositions.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns The minimum number of operations required to transform str1 into str2
 */
export function damerauLevenshtein(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Early exit for identical strings
  if (str1 === str2) {
    return 0;
  }

  // Handle empty strings
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  // Initialize the distance matrix
  const matrix = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

  // Fill first row and column
  for (let i = 0; i <= len1; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );

      // Check for transposition (Damerau extension)
      if (
        i > 1 &&
        j > 1 &&
        str1[i - 1] === str2[j - 2] &&
        str1[i - 2] === str2[j - 1]
      ) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
      }
    }
  }

  return matrix[len1][len2];
}

/**
 * Checks if two strings are similar within a given distance threshold.
 * Optimized to exit early if distance exceeds threshold.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @param maxDistance - Maximum allowed distance
 * @returns True if distance <= maxDistance, false otherwise
 */
export function isSimilar(str1: string, str2: string, maxDistance: number): boolean {
  return damerauLevenshtein(str1, str2) <= maxDistance;
}
