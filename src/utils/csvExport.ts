const CSV_MIME_TYPE = 'text/csv;charset=utf-8;';
const GZIP_MIME_TYPE = 'application/gzip';

export type CsvExportFormat = 'csv' | 'csv.gz';
export type CsvExtension = '.csv' | '.csv.gz';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Quotes a cell for CSV. Cells that a spreadsheet would run as a formula (leading = + - @ tab CR)
 * get a leading apostrophe, unless they are plain numbers such as "-5".
 */
export const escapeCsvCell = (value: unknown): string => {
  let text = value == null ? '' : String(value);
  if (FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
};

export const serializeCsvRow = (cells: unknown[]): string => `${cells.map(escapeCsvCell).join(',')}\n`;

export const serializeToCsv = (headers: string[], rows: unknown[][]): string =>
  [headers, ...rows].map(serializeCsvRow).join('');

export const gzipBlob = async (blob: Blob): Promise<Blob> => {
  const compressed = blob.stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(compressed).blob()], { type: GZIP_MIME_TYPE });
};

export const buildCsvBlob = async (
  csv: string | Blob,
  format: CsvExportFormat
): Promise<{ blob: Blob; extension: CsvExtension; mimeType: string }> => {
  const blob = typeof csv === 'string' ? new Blob([csv], { type: CSV_MIME_TYPE }) : csv;
  if (format === 'csv') {
    return { blob, extension: '.csv', mimeType: CSV_MIME_TYPE };
  }
  return { blob: await gzipBlob(blob), extension: '.csv.gz', mimeType: GZIP_MIME_TYPE };
};

export function generateExportFilename(originalFilename: string, extension: CsvExtension = '.csv'): string {
  const baseName = originalFilename.replace(/\.[^/.]+$/, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `data_export_${baseName}_${timestamp}${extension}`;
}
