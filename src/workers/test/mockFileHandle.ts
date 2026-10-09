export interface MockFileHandleOptions {
  name?: string;
  type?: string;
  lastModified?: number;
  /** Replaces `file.stream()`, e.g. to hold the stream open until a test releases it. */
  stream?: () => ReadableStream<Uint8Array>;
}

/**
 * Builds a minimal FileSystemFileHandle compatible with the ingestion pipeline.
 * Backed by an in-memory File so worker tests can stream CSV data without OPFS.
 */
export const createMockFileHandle = (
  contents: string | Uint8Array,
  { name = 'mock.csv', type = 'text/csv', lastModified = Date.now(), stream }: MockFileHandleOptions = {}
): FileSystemFileHandle => {
  const file = new File([contents as BlobPart], name, { type, lastModified });
  if (stream) {
    Object.defineProperty(file, 'stream', { value: stream });
  }

  const handle: Partial<FileSystemFileHandle> = {
    kind: 'file',
    name,
    getFile: async () => file,
    isSameEntry: async (other) => other === (handle as FileSystemFileHandle),
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted'
  };

  return handle as FileSystemFileHandle;
};
