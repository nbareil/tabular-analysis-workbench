export type CompressionKind = 'gzip' | null;

const CSV_OR_TSV_GZIP_PATTERN = /\.(csv|tsv)\.g?z(ip)?$/i;

/**
 * Determine whether a file should be decompressed before parsing.
 * The worker may receive files without type metadata, so we fall back to
 * filename heuristics that match the extensions listed in PRD §4.1.
 */
export const detectCompression = (params: {
  fileName?: string;
  mimeType?: string;
}): CompressionKind => {
  const { fileName, mimeType } = params;

  if (mimeType && mimeType.toLowerCase() === 'application/gzip') {
    return 'gzip';
  }

  if (fileName) {
    if (CSV_OR_TSV_GZIP_PATTERN.test(fileName)) {
      return 'gzip';
    }
  }

  return null;
};
