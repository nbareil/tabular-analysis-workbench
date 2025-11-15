export interface MockFileHandleOptions {
  name?: string;
  type?: string;
  lastModified?: number;
}

/**
 * Builds a minimal FileSystemFileHandle compatible with the ingestion pipeline.
 * Backed by an in-memory File so worker tests can stream CSV data without OPFS.
 */
export const createMockFileHandle = (
  contents: string,
  { name = 'mock.csv', type = 'text/csv', lastModified = Date.now() }: MockFileHandleOptions = {}
): FileSystemFileHandle => {
  const textEncoder = new TextEncoder();
  const encoded = textEncoder.encode(contents);

  const toBuffer = (): ArrayBuffer => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const createStream = (): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(toBuffer()));
        controller.close();
      }
    });

  const file: File = {
    name,
    type,
    lastModified,
    size: encoded.byteLength,
    stream: createStream,
    arrayBuffer: async () => toBuffer(),
    text: async () => contents,
    slice: (...args: Parameters<Blob['slice']>) => new Blob([contents], { type }).slice(...args)
  } as File;

  const handle: Partial<FileSystemFileHandle> = {
    kind: 'file',
    name: file.name,
    getFile: async () => file,
    isSameEntry: async (other) => other === (handle as FileSystemFileHandle),
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted'
  };

  return handle as FileSystemFileHandle;
};
