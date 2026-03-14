export interface DatasetFingerprint {
  fileName: string;
  fileSize: number;
  lastModified: number;
}

export const createDatasetFingerprint = (
  file: File,
  handle: FileSystemFileHandle
): DatasetFingerprint => ({
  fileName: file.name ?? handle.name ?? 'unknown',
  fileSize: file.size ?? 0,
  lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0
});
