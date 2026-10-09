export interface DatasetFingerprint {
  fileName: string;
  fileSize: number;
  lastModified: number;
}

const sanitizeSegment = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
};

export const buildDatasetStorageKey = (fingerprint: DatasetFingerprint): string => {
  const baseName =
    typeof fingerprint.fileName === 'string' && fingerprint.fileName.trim().length > 0
      ? fingerprint.fileName
      : 'dataset';
  const fileName = sanitizeSegment(baseName) || 'dataset';
  const fileSize =
    typeof fingerprint.fileSize === 'number' && Number.isFinite(fingerprint.fileSize)
      ? Math.max(0, Math.floor(fingerprint.fileSize))
      : 0;
  const lastModified =
    typeof fingerprint.lastModified === 'number' && Number.isFinite(fingerprint.lastModified)
      ? Math.max(0, Math.floor(fingerprint.lastModified))
      : 0;

  return `${fileName}-${fileSize}-${lastModified}`;
};

/** Identifies a dataset by its files' names, sizes and modification times. */
export const createDatasetFingerprint = (files: File[]): DatasetFingerprint => ({
  fileName: files.map((file) => file.name).join('+'),
  fileSize: files.reduce((total, file) => total + file.size, 0),
  lastModified: Math.max(0, ...files.map((file) => file.lastModified))
});
