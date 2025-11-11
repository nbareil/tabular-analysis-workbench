/**
 * Calculates the Damerau-Levenshtein distance between two strings.
 * Supports optional early exit when distance exceeds `maxDistance`.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @param maxDistance - Optional threshold; computation short-circuits once exceeded
 * @returns Distance if <= maxDistance, otherwise > maxDistance
 */
export function damerauLevenshtein(
  str1: string,
  str2: string,
  maxDistance?: number
): number {
  if (str1 === str2) {
    return 0;
  }

  let source = str1;
  let target = str2;

  if (source.length > target.length) {
    [source, target] = [target, source];
  }

  const len1 = source.length;
  const len2 = target.length;

  if (len1 === 0) {
    return len2;
  }
  if (len2 === 0) {
    return len1;
  }

  const threshold =
    typeof maxDistance === 'number' && Number.isFinite(maxDistance) && maxDistance >= 0
      ? Math.floor(maxDistance)
      : Number.POSITIVE_INFINITY;

  if (threshold !== Number.POSITIVE_INFINITY && Math.abs(len1 - len2) > threshold) {
    return threshold + 1;
  }

  let prev = new Array<number>(len2 + 1);
  let curr = new Array<number>(len2 + 1);
  let prevPrev = new Array<number>(len2 + 1);
  const INF = Number.POSITIVE_INFINITY;

  for (let j = 0; j <= len2; j += 1) {
    prev[j] = j;
    curr[j] = 0;
    prevPrev[j] = INF;
  }

  for (let i = 1; i <= len1; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const sourceChar = source[i - 1]!;

    let start = 1;
    let end = len2;

    if (threshold !== Number.POSITIVE_INFINITY) {
      // Limit evaluation to band around the diagonal so we can short-circuit when distance exceeds the threshold.
      start = Math.max(1, i - threshold);
      end = Math.min(len2, i + threshold);

      const boundedStart = Math.min(start, len2 + 1);
      for (let j = 1; j < boundedStart; j += 1) {
        curr[j] = INF;
      }
      const boundedAfter = Math.min(len2 + 1, end + 1);
      for (let j = boundedAfter; j <= len2; j += 1) {
        curr[j] = INF;
      }
    }

    for (let j = start; j <= end; j += 1) {
      const targetChar = target[j - 1]!;
      const cost = sourceChar === targetChar ? 0 : 1;

      const deletion = prev[j] + 1;
      const insertion = curr[j - 1] + 1;
      const substitution = prev[j - 1] + cost;

      let value = Math.min(deletion, insertion, substitution);

      if (
        i > 1 &&
        j > 1 &&
        sourceChar === target[j - 2] &&
        source[i - 2] === targetChar
      ) {
        value = Math.min(value, prevPrev[j - 2] + cost);
      }

      curr[j] = value;
      if (value < rowMin) {
        rowMin = value;
      }
    }

    if (threshold !== Number.POSITIVE_INFINITY && rowMin > threshold) {
      return threshold + 1;
    }

    const temp = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = temp;
  }

  return prev[len2];
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
  return damerauLevenshtein(str1, str2, maxDistance) <= maxDistance;
}
