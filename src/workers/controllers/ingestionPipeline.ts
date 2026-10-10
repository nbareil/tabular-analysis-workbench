import { parseDelimitedStream } from '../csvParser';
import { parseJsonLinesStream } from '../jsonLinesParser';
import { buildDatasetStorageKey, createDatasetFingerprint } from '../datasetFingerprint';
import { isGzip } from '../utils/detectCompression';
import { detectFormat } from '../utils/detectFormat';
import { encodeColumn, RowBatchStore } from '../rowBatchStore';
import { startPerformanceMeasure } from '../utils/performanceMarks';
import { logDebug } from '../../utils/debugLog';
import { StaleOperationError, type DataWorkerStateController, type DatasetState } from '../state/dataWorkerState';
import type { ColumnInference, ColumnType } from '../types';
import type { LoadFileCallbacks, LoadFileRequest } from '../workerApiTypes';

/** Column added when several files are merged, naming the file each row came from. */
export const SOURCE_COLUMN = 'source_file';

const now = (): number => performance.now();

export interface IngestionPipeline {
  run(request: LoadFileRequest, callbacks: LoadFileCallbacks): Promise<void>;
}

/**
 * Column types of a merged dataset: a column keeps its inferred type only when every file that
 * has it agrees; otherwise it falls back to text.
 */
const mergeColumnTypes = (perFile: Array<Record<string, ColumnType>>): Record<string, ColumnType> => {
  const merged: Record<string, ColumnType> = {};
  for (const types of perFile) {
    for (const [column, type] of Object.entries(types)) {
      merged[column] = merged[column] == null || merged[column] === type ? type : 'string';
    }
  }
  return merged;
};

const sourceInference = (fileNames: string[], rows: number): ColumnInference => ({
  type: 'string',
  confidence: 1,
  samples: rows,
  nullCount: 0,
  examples: fileNames.slice(0, 5)
});

/**
 * Streams one or more files into a fresh RowBatchStore, each parsed as delimited text or JSON Lines
 * according to its content. Several files become one dataset whose columns are the union of theirs
 * plus SOURCE_COLUMN. Starting another load supersedes this one: the superseded load cancels its
 * reader, discards its store and rejects with StaleOperationError.
 */
export const createIngestionPipeline = (state: DataWorkerStateController): IngestionPipeline => {
  let latestLoad = 0;

  const run = async (
    { handles, delimiter, batchSize, encoding }: LoadFileRequest,
    callbacks: LoadFileCallbacks
  ): Promise<void> => {
    const measure = startPerformanceMeasure('csv-ingest');
    const startTime = now();
    const loadId = ++latestLoad;
    let batchStore: RowBatchStore | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      if (!handles.length) {
        throw new Error('Select at least one file to open.');
      }
      await state.persistTaggingNow();
      state.resetTagging();

      const previousStore = state.dataset.batchStore;
      state.resetDataset();
      void previousStore?.dispose();

      const files = await Promise.all(handles.map((handle) => handle.getFile()));
      const fingerprint = createDatasetFingerprint(files);
      batchStore = await RowBatchStore.create(buildDatasetStorageKey(fingerprint));
      if (loadId !== latestLoad) {
        throw new StaleOperationError();
      }
      const merged = files.length > 1;
      const dataset: DatasetState = state.startDataset({ batchStore, fileName: fingerprint.fileName });
      const check = (): void => {
        if (state.dataset !== dataset) {
          throw new StaleOperationError();
        }
      };

      await state.hydrateTagging(fingerprint, dataset);
      check();

      // Each file's columns in its own order; JSON Lines files insert columns as new keys appear.
      const columnsPerFile: string[][] = [];
      let union: string[] = [];
      const typesPerFile: Array<Record<string, ColumnType>> = [];
      const inference: Record<string, ColumnInference> = {};
      let bytesRead = 0;
      let batchesStored = 0;
      let malformedRows = 0;

      const publishSchema = (): void => {
        dataset.header = merged ? [SOURCE_COLUMN, ...union] : [...union];
        dataset.columnTypes = merged
          ? { [SOURCE_COLUMN]: 'string', ...mergeColumnTypes(typesPerFile) }
          : { ...typesPerFile[0] };
        dataset.columnInference = Object.fromEntries(
          dataset.header.map((column) => [
            column,
            column === SOURCE_COLUMN && merged
              ? sourceInference(files.map((file) => file.name), dataset.totalRows)
              : { ...inference[column]!, type: dataset.columnTypes[column] ?? 'string' }
          ])
        );
      };

      for (const [fileIndex, file] of files.entries()) {
        let stream: ReadableStream<Uint8Array> = file.stream().pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytesRead += chunk.byteLength;
              controller.enqueue(chunk);
            }
          })
        );
        if (await isGzip(file)) {
          stream = stream.pipeThrough(
            new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>
          );
        }
        const activeReader = stream.getReader();
        reader = activeReader;
        const { format, source } = await detectFormat({
          async *[Symbol.asyncIterator]() {
            while (true) {
              check();
              const { value, done } = await activeReader.read();
              if (done) {
                return;
              }
              yield value;
            }
          }
        });
        if (format === 'json') {
          throw new Error(
            `${file.name} is a JSON document, not JSON Lines. Open a file with one JSON object per line ` +
              `(for an array of objects: jq -c '.[]' ${file.name}).`
          );
        }
        const parse = format === 'jsonl' ? parseJsonLinesStream : parseDelimitedStream;

        typesPerFile[fileIndex] = {};
        let fileMalformedRows = 0;
        await parse(
          source,
          {
            onColumns: async (columns) => {
              check();
              columnsPerFile[fileIndex] = columns;
              union = [...new Set(columnsPerFile.flat())];
              const fileTypes = typesPerFile[fileIndex]!;
              for (const column of columns) {
                if (!Object.hasOwn(inference, column)) {
                  inference[column] = { type: 'string', confidence: 0, samples: 0, nullCount: 0, examples: [] };
                }
                // Known types stay: a filter may run while this load waits on the callback below.
                if (!Object.hasOwn(fileTypes, column)) {
                  fileTypes[column] = 'string';
                }
              }
              publishSchema();
              await callbacks.onColumns?.({ columns: dataset.header });
            },
            onBatch: async (batch) => {
              check();
              if (merged) {
                batch.columns[SOURCE_COLUMN] = encodeColumn(new Array<string>(batch.rowIds.length).fill(file.name));
              }
              await batchStore!.storeBatch(batch);
              check();
              batchesStored += 1;
              fileMalformedRows = batch.stats.malformedRows;
              typesPerFile[fileIndex] = batch.columnTypes;
              for (const [column, columnInference] of Object.entries(batch.columnInference)) {
                if (fileIndex === 0 || inference[column]!.samples === 0) {
                  inference[column] = columnInference;
                }
              }
              dataset.totalRows = batchStore!.totalRows;
              dataset.bytesParsed = bytesRead;
              publishSchema();
              await callbacks.onProgress?.({
                rowsParsed: dataset.totalRows,
                bytesParsed: bytesRead,
                batchesStored,
                columnTypes: dataset.columnTypes
              });
            }
          },
          { delimiter, batchSize, encoding, reservedColumns: merged ? [SOURCE_COLUMN] : [] }
        );
        malformedRows += fileMalformedRows;
        check();
      }

      dataset.loading = false;
      dataset.bytesParsed = bytesRead;
      dataset.malformedRows = malformedRows;
      publishSchema();
      const durationMs = now() - startTime;
      if (state.options.debugLogging) {
        logDebug('data-worker', 'Load complete', {
          files: files.length,
          rows: dataset.totalRows,
          bytes: bytesRead,
          batchesStored,
          malformedRows,
          durationMs: Math.round(durationMs)
        });
      }
      await callbacks.onComplete?.({
        columns: dataset.header,
        rowsParsed: dataset.totalRows,
        bytesParsed: bytesRead,
        malformedRows,
        durationMs,
        columnTypes: dataset.columnTypes,
        columnInference: dataset.columnInference
      });
    } catch (error) {
      void reader?.cancel().catch(() => undefined);
      if (error instanceof StaleOperationError) {
        if (batchStore && state.dataset.batchStore !== batchStore) {
          void batchStore.dispose();
        }
        throw error;
      }
      state.dataset.loading = false;
      await callbacks.onError?.(
        error instanceof Error
          ? { message: error.message, name: error.name, stack: error.stack }
          : { message: String(error) }
      );
      throw error;
    } finally {
      measure?.();
    }
  };

  return { run };
};
