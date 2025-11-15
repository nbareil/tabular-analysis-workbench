## Row batch persistence notes

The worker persists streamed batches to OPFS so large datasets stay within the 600 MB budget. Prior to `csv-explorer-h6m`, every `storeBatch()` call cloned each typed array into a brand new `ArrayBuffer` before forwarding it to the OPFS writer, effectively doubling the memory traffic per column and inserting a synchronous memcpy into the hot ingestion loop.

### Buffer streaming strategy

- Typed arrays (row ids, offsets, numeric/boolean data, null masks) are now wrapped in `Uint8Array` views that reference the original buffer/byte offset, so `FileSystemWritableFileStream.write()` receives the bytes directly without intermediate copies.
- Fixed-size `ArrayBuffer` payloads (e.g., string column data) are passed through untouched.
- Memory-fallback mode continues to retain the original `RowBatch` objects since no OPFS writer is involved.

### Microbenchmark

You can reproduce the cost of the old cloning helpers on a 1 M-row batch via Node:

```bash
node - <<'EOF'
const rows = 1_000_000;
const rowIds = new Uint32Array(rows);
const offsets = new Uint32Array(rows + 1);
const stringData = new Uint8Array(rows * 4);
const numberData = new Float64Array(rows);
const nullMask = new Uint8Array(Math.ceil(rows / 8));

const cloneViewToArrayBuffer = (view) => {
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return buffer;
};

console.time('clone-row-batch');
cloneViewToArrayBuffer(rowIds);
cloneViewToArrayBuffer(offsets);
cloneViewToArrayBuffer(stringData);
cloneViewToArrayBuffer(numberData);
cloneViewToArrayBuffer(nullMask);
console.timeEnd('clone-row-batch');
EOF
```

On the dev machine this reports ~11 ms per batch solely for cloning, so eliminating the copies removes an entire frame’s worth of CPU time for each persisted batch (and twice that during gzip-backed ingestion). OPFS writes now operate on the original buffers, so throughput improvements scale with batch count.
