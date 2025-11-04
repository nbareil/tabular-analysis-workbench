import type { FuzzyIndexSnapshot, FuzzyIndexFingerprint } from './fuzzyIndexStore';

export const createFuzzyFingerprint = (
  file: File,
  handle: FileSystemFileHandle
): FuzzyIndexFingerprint => ({
  fileName: file.name ?? handle.name ?? 'unknown',
  fileSize: file.size ?? 0,
  lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0
});

export const fuzzySnapshotMatchesFingerprint = (
  snapshot: FuzzyIndexSnapshot,
  fingerprint: FuzzyIndexFingerprint
): boolean => {
  const fingerprintMatches =
    snapshot.fingerprint.fileName === fingerprint.fileName &&
    snapshot.fingerprint.fileSize === fingerprint.fileSize &&
    snapshot.fingerprint.lastModified === fingerprint.lastModified;

  if (!fingerprintMatches) {
    return false;
  }

  if (
    Number.isFinite(snapshot.bytesParsed) &&
    snapshot.bytesParsed > 0 &&
    Number.isFinite(fingerprint.fileSize) &&
    fingerprint.fileSize > 0 &&
    snapshot.bytesParsed !== fingerprint.fileSize
  ) {
    return false;
  }

  return true;
};
