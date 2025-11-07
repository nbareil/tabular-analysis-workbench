export function serializeToCsv(headers: string[], rows: (string | null | undefined)[][]): string {
  const all = [headers, ...rows];
  return all
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function generateExportFilename(originalFilename: string): string {
  const baseName = originalFilename.replace(/\.[^/.]+$/, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `data_export_${baseName}_${timestamp}.csv`;
}
