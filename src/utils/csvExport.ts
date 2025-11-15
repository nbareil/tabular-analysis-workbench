const CSV_MIME_TYPE = 'text/csv;charset=utf-8;';
const GZIP_MIME_TYPE = 'application/gzip';

export type CsvExportFormat = 'csv' | 'csv.gz';
export type CsvExtension = '.csv' | '.csv.gz';

export function serializeToCsv(headers: string[], rows: (string | null | undefined)[][]): string {
  const all = [headers, ...rows];
  return all
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

const buildCsvBlobPayload = (csv: string): Blob => new Blob([csv], { type: CSV_MIME_TYPE });

export const buildCsvBlob = async (
  csv: string,
  format: CsvExportFormat
): Promise<{ blob: Blob; extension: CsvExtension; mimeType: string }> => {
  if (format === 'csv') {
    return {
      blob: buildCsvBlobPayload(csv),
      extension: '.csv',
      mimeType: CSV_MIME_TYPE
    };
  }

  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream API is not available in this environment.');
  }

  const compressedStream = buildCsvBlobPayload(csv).stream().pipeThrough(new CompressionStream('gzip'));
  const response = new Response(compressedStream);
  const buffer = await response.arrayBuffer();
  return {
    blob: new Blob([buffer], { type: GZIP_MIME_TYPE }),
    extension: '.csv.gz',
    mimeType: GZIP_MIME_TYPE
  };
};

export function generateExportFilename(
  originalFilename: string,
  extension: CsvExtension = '.csv'
): string {
  const baseName = originalFilename.replace(/\.[^/.]+$/, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `data_export_${baseName}_${timestamp}${extension}`;
}
