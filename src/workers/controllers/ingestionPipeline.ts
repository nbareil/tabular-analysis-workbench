import { parseDelimitedStream, type ParserOptions } from '../csvParser';
import { FuzzyIndexBuilder } from '../fuzzyIndexBuilder';
import { detectCompression } from '../utils/detectCompression';
import { RowBatchStore } from '../rowBatchStore';
import { RowIndexStore } from '../rowIndexStore';
import {
  FuzzyIndexStore,
  FUZZY_INDEX_STORE_VERSION
} from '../fuzzyIndexStore';
import { createFuzzyFingerprint, fuzzySnapshotMatchesFingerprint } from '../fuzzyIndexUtils';
import { startPerformanceMeasure } from '../utils/performanceMarks';
import { logDebug } from '../../utils/debugLog';
import type { DataWorkerStateController } from '../state/dataWorkerState';
import type {
  LoadFileCallbacks,
  LoadFileRequest,
  LoadCompleteSummary
} from '../workerApiTypes';
import type { ColumnInference, ColumnType } from '../types';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const roundMs = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
};

export interface IngestionPipeline {
  init(): Promise<void>;
  clear(): Promise<void>;
  run(request: LoadFileRequest, callbacks: LoadFileCallbacks): Promise<void>;
}

interface IngestionDeps {
  state: DataWorkerStateController;
}

export const createIngestionPipeline = ({ state }: IngestionDeps): IngestionPipeline => {
  const init = async (): Promise<void> => {
    // No-op for now
  };

  const clear = async (): Promise<void> => {
    if (state.dataset.batchStore) {
      try {
        await state.dataset.batchStore.clear();
      } catch (error) {
        console.warn('[data-worker][ingestion] Failed to clear batch store', error);
      }
    }
    state.resetDataset();
    state.resetTagging();
  };

  const run = async (
    { handle, delimiter, batchSize, encoding, checkpointInterval }: LoadFileRequest,
    callbacks: LoadFileCallbacks
  ): Promise<void> => {
    if (!handle) {
      throw new Error('A file handle must be provided to loadFile.');
    }

    await state.persistTaggingNow();
    state.resetTagging();

    const debugEnabled = state.options.debugLogging;
    const slowBatchThreshold = state.options.slowBatchThresholdMs;
    let datasetKey = 'pending';
    const debugLog = (event: string, payload?: Record<string, unknown>) => {
      if (!debugEnabled) {
        return;
      }
      logDebug(`data-worker][dataset:${datasetKey}`, event, payload);
    };
    const ingestionMeasure = startPerformanceMeasure('csv-ingest');

    if (state.dataset.batchStore) {
      const clearStart = now();
      try {
        await state.dataset.batchStore.clear();
        debugLog('Cleared existing batch store', { durationMs: roundMs(now() - clearStart) });
      } catch (error) {
        console.warn('[data-worker] Failed to clear existing batch store', error);
        debugLog('Failed clearing existing batch store', {
          durationMs: roundMs(now() - clearStart),
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    datasetKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const batchStoreStart = now();
    const batchStore = await RowBatchStore.create(datasetKey);
    debugLog('RowBatchStore.create completed', { durationMs: roundMs(now() - batchStoreStart) });

    state.prepareDatasetForLoad({
      batchStore,
      datasetKey,
      fileHandle: handle
    });

    const fileStart = now();
    const file = await handle.getFile();
    debugLog('handle.getFile resolved', {
      durationMs: roundMs(now() - fileStart),
      name: file.name ?? handle.name ?? 'unknown',
      size: file.size,
      type: file.type
    });

    const fuzzyFingerprint = createFuzzyFingerprint(file, handle);
    const fuzzyStoreStart = now();
    const fuzzyIndexStore = await FuzzyIndexStore.create(handle);
    debugLog('FuzzyIndexStore.create completed', {
      durationMs: roundMs(now() - fuzzyStoreStart)
    });
    state.updateDataset((dataset) => {
      dataset.fuzzyIndexStore = fuzzyIndexStore;
      dataset.fuzzyFingerprint = fuzzyFingerprint;
    });

    const cachedFuzzyIndex = await fuzzyIndexStore.load();
    let fuzzyIndexBuilder: FuzzyIndexBuilder | undefined;

    if (
      cachedFuzzyIndex &&
      fuzzySnapshotMatchesFingerprint(cachedFuzzyIndex, fuzzyFingerprint)
    ) {
      state.updateDataset((dataset) => {
        dataset.fuzzyIndexSnapshot = cachedFuzzyIndex;
      });
      debugLog('Hydrated fuzzy index snapshot from cache', {
        createdAt: cachedFuzzyIndex.createdAt,
        columnCount: cachedFuzzyIndex.columns.length,
        tokenLimit: cachedFuzzyIndex.tokenLimit
      });
    } else {
      if (cachedFuzzyIndex) {
        debugLog('Discarded stale fuzzy index snapshot', {
          cachedFingerprint: cachedFuzzyIndex.fingerprint,
          expectedFingerprint: fuzzyFingerprint
        });
        await fuzzyIndexStore.clear();
      }

      fuzzyIndexBuilder = new FuzzyIndexBuilder();
      debugLog('Created new FuzzyIndexBuilder for parsing');
    }

    await state.hydrateTaggingStore(fuzzyFingerprint);

    const compression = detectCompression({
      fileName: file.name ?? handle.name,
      mimeType: file.type
    });
    debugLog('Compression detected', { compression: compression ?? 'none' });

    let stream: ReadableStream<Uint8Array> = file.stream();

    if (compression === 'gzip') {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser does not support gzip decompression.');
      }

      try {
        stream = stream.pipeThrough(new DecompressionStream('gzip') as any);
        debugLog('Applied gzip DecompressionStream');
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? `Failed to decompress gzip stream: ${error.message}`
            : 'Failed to decompress gzip stream'
        );
      }
    }

    const reader = stream.getReader();
    const targetCheckpointInterval = checkpointInterval ?? 50_000;
    const parserOptions: ParserOptions = {
      delimiter,
      batchSize,
      encoding,
      checkpointInterval: targetCheckpointInterval,
      fuzzyIndexBuilder
    };

    const startTime = now();
    let finalRows = 0;
    let finalBytes = 0;
    let storedBatches = 0;
    let previousRowsParsed = 0;
    let previousBytesParsed = 0;

    let totalStoreDurationMs = 0;
    let longestStoreDurationMs = 0;
    let slowStoreBatchCount = 0;

    let totalProgressCallbackMs = 0;
    let longestProgressCallbackMs = 0;

    let checkpointCount = 0;
    let totalCheckpointMs = 0;
    let longestCheckpointMs = 0;

    let chunkCount = 0;
    let totalReadMs = 0;
    let longestReadMs = 0;

    const indexStoreStart = now();
    const indexStore = await RowIndexStore.create(handle, {
      checkpointInterval: targetCheckpointInterval
    });
    debugLog('RowIndexStore.create completed', { durationMs: roundMs(now() - indexStoreStart) });

    const source: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const readStart = now();
            const { value, done } = await reader.read();
            const readDuration = now() - readStart;

            if (done) {
              return;
            }

            if (value) {
              chunkCount += 1;
              totalReadMs += readDuration;
              if (readDuration > longestReadMs) {
                longestReadMs = readDuration;
              }

              if (debugEnabled && readDuration >= slowBatchThreshold) {
                debugLog('Slow chunk read', {
                  chunkIndex: chunkCount,
                  readDurationMs: roundMs(readDuration)
                });
              }

              yield value;
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    };

    try {
      debugLog('Starting parseDelimitedStream', {
        delimiter: delimiter ?? 'auto',
        batchSize: batchSize ?? 'default',
        encoding: encoding ?? 'utf-8',
        checkpointInterval: targetCheckpointInterval
      });
      const parseStartTime = now();
      const parseMeasure = startPerformanceMeasure('csv-parse');
      let parseMetrics: Awaited<ReturnType<typeof parseDelimitedStream>> | undefined;

      try {
        parseMetrics = await parseDelimitedStream(
        source,
        {
          onHeader: async (header) => {
            state.updateDataset((dataset) => {
              dataset.header = header;
            });
            if (callbacks.onStart) {
              const callbackStart = now();
              await callbacks.onStart({ columns: header });
              const duration = now() - callbackStart;
              debugLog('onStart callback completed', {
                durationMs: roundMs(duration),
                columnCount: header.length
              });
            } else {
              debugLog('No onStart callback provided', { columnCount: header.length });
            }
          },
          onBatch: async (batch) => {
            finalRows = batch.stats.rowsParsed;
            finalBytes = batch.stats.bytesParsed;
            storedBatches += 1;

            const rowsInBatch = Math.max(0, finalRows - previousRowsParsed);
            const bytesInBatch = Math.max(0, finalBytes - previousBytesParsed);
            previousRowsParsed = finalRows;
            previousBytesParsed = finalBytes;

            const storeStart = now();
            await batchStore.storeBatch(batch);
            const storeDuration = now() - storeStart;
            totalStoreDurationMs += storeDuration;
            if (storeDuration > longestStoreDurationMs) {
              longestStoreDurationMs = storeDuration;
            }

            const shouldLogBatch =
              storeDuration >= slowBatchThreshold || storedBatches <= 5 || storedBatches % 50 === 0;

            if (storeDuration >= slowBatchThreshold) {
              slowStoreBatchCount += 1;
            }

            if (shouldLogBatch) {
              debugLog('Stored batch', {
                batchesStored: storedBatches,
                rowsInBatch,
                cumulativeRowsParsed: finalRows,
                cumulativeBytesParsed: finalBytes,
                storeDurationMs: roundMs(storeDuration),
                slowStore: storeDuration >= slowBatchThreshold,
                bytesInBatch
              });
            }

            state.updateDataset((dataset) => {
              dataset.columnTypes = {
                ...dataset.columnTypes,
                ...batch.columnTypes
              } as Record<string, ColumnType>;
              dataset.columnInference = {
                ...dataset.columnInference,
                ...batch.columnInference
              } as Record<string, ColumnInference>;
              dataset.totalRows = finalRows;
              dataset.bytesParsed = finalBytes;
            });

            if (callbacks.onProgress) {
              const payload = {
                rowsParsed: finalRows,
                bytesParsed: finalBytes,
                batchesStored: storedBatches
              };
              const progressStart = now();
              await callbacks.onProgress(payload);
              const progressDuration = now() - progressStart;
              totalProgressCallbackMs += progressDuration;
              if (progressDuration > longestProgressCallbackMs) {
                longestProgressCallbackMs = progressDuration;
              }

              if (progressDuration >= slowBatchThreshold) {
                debugLog('Slow onProgress callback detected', {
                  durationMs: roundMs(progressDuration),
                  batchesStored: storedBatches
                });
              }
            }
          },
          onCheckpoint: async ({ rowIndex, byteOffset }) => {
            const checkpointStart = now();
            indexStore.record({ rowIndex, byteOffset });
            const checkpointDuration = now() - checkpointStart;
            checkpointCount += 1;
            totalCheckpointMs += checkpointDuration;

            if (checkpointDuration > longestCheckpointMs) {
              longestCheckpointMs = checkpointDuration;
            }

            if (checkpointDuration >= slowBatchThreshold) {
              debugLog('Slow checkpoint record detected', {
                rowIndex,
                byteOffset,
                checkpointDurationMs: roundMs(checkpointDuration)
              });
            }
          }
        },
        parserOptions
      );
      } finally {
        parseMeasure?.();
      }

      debugLog('parseDelimitedStream completed', {
        durationMs: roundMs(now() - parseStartTime),
        storedBatches,
        rowsParsed: finalRows,
        bytesParsed: finalBytes
      });

      state.updateDataset((dataset) => {
        dataset.totalRows = finalRows;
        dataset.bytesParsed = finalBytes;
      });

      const fuzzyRowBuildMs = roundMs(parseMetrics?.fuzzyRowBuildMs ?? 0);
      let fuzzySnapshotMs = 0;

      if (fuzzyIndexBuilder) {
        const fuzzyMeasure = startPerformanceMeasure('fuzzy-build');
        const buildStart = now();
        const columnSnapshots = fuzzyIndexBuilder.buildSnapshots();
        const snapshotDuration = now() - buildStart;
        fuzzySnapshotMs = roundMs(snapshotDuration);
        debugLog('FuzzyIndexBuilder.buildSnapshots completed', {
          durationMs: fuzzySnapshotMs,
          columnCount: columnSnapshots.length
        });

        const fuzzySnapshot = {
          version: FUZZY_INDEX_STORE_VERSION,
          createdAt: Date.now(),
          rowCount: finalRows,
          bytesParsed: finalBytes,
          tokenLimit: fuzzyIndexBuilder.getTokenLimit(),
          trigramSize: fuzzyIndexBuilder.getTrigramSize(),
          fingerprint: fuzzyFingerprint,
          columns: columnSnapshots
        };

        const persistStart = now();
        await fuzzyIndexStore.save(fuzzySnapshot);
        debugLog('FuzzyIndexStore.save completed', {
          durationMs: roundMs(now() - persistStart)
        });

        state.updateDataset((dataset) => {
          dataset.fuzzyIndexSnapshot = fuzzySnapshot;
        });
        fuzzyMeasure?.();
      }

      if (callbacks.onComplete) {
        const endTime = now();
        const summary: LoadCompleteSummary = {
          rowsParsed: finalRows,
          bytesParsed: finalBytes,
          durationMs: endTime - startTime,
          columnTypes: state.dataset.columnTypes,
          columnInference: state.dataset.columnInference,
          metrics: {
            fuzzyRowBuildMs,
            fuzzySnapshotMs
          }
        };
        const completeStart = now();
        await callbacks.onComplete(summary);
        const completeDuration = now() - completeStart;
        debugLog('onComplete callback completed', {
          durationMs: roundMs(completeDuration),
          rowsParsed: finalRows,
          bytesParsed: finalBytes
        });
        if (completeDuration >= slowBatchThreshold) {
          debugLog('Slow onComplete callback detected', {
            durationMs: roundMs(completeDuration)
          });
        }
      }

      const finalizeStart = now();
      await indexStore.finalize({ rowCount: finalRows, bytesParsed: finalBytes });
      debugLog('RowIndexStore.finalize completed', {
        durationMs: roundMs(now() - finalizeStart),
        rowCount: finalRows,
        bytesParsed: finalBytes
      });

      debugLog('Load complete summary', {
        totalDurationMs: roundMs(now() - startTime),
        rowsParsed: finalRows,
        bytesParsed: finalBytes,
        storedBatches,
        chunkCount,
        slowStoreBatchCount,
        fuzzyRowBuildMs,
        fuzzySnapshotMs,
        longestStoreBatchMs: roundMs(longestStoreDurationMs),
        averageStoreBatchMs:
          storedBatches > 0 ? roundMs(totalStoreDurationMs / storedBatches) : 0,
        checkpointCount,
        longestCheckpointMs: roundMs(longestCheckpointMs),
        averageCheckpointMs:
          checkpointCount > 0 ? roundMs(totalCheckpointMs / checkpointCount) : 0,
        longestReadMs: roundMs(longestReadMs),
        averageReadMs: chunkCount > 0 ? roundMs(totalReadMs / chunkCount) : 0,
        longestProgressCallbackMs: roundMs(longestProgressCallbackMs),
        totalProgressCallbackMs: roundMs(totalProgressCallbackMs),
        averageProgressCallbackMs:
          storedBatches > 0 ? roundMs(totalProgressCallbackMs / storedBatches) : 0
      });
    } catch (error) {
      debugLog('loadFile encountered error', {
        message: error instanceof Error ? error.message : String(error)
      });
      await indexStore.abort();
      if (callbacks.onError) {
        const normalised =
          error instanceof Error
            ? { message: error.message, name: error.name, stack: error.stack }
            : { message: String(error) };
        await callbacks.onError(normalised);
      }

      throw error;
    } finally {
      ingestionMeasure?.();
    }
  };

  return {
    init,
    clear,
    run
  };
};
