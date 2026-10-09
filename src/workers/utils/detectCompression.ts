/** True when the file starts with the gzip magic bytes (1f 8b), whatever its name or MIME type. */
export const isGzip = async (file: Blob): Promise<boolean> => {
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return header[0] === 0x1f && header[1] === 0x8b;
};
