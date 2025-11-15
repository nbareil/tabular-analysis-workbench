## Data worker state boundary

The worker used to mutate a globally-scoped `state` object inside `dataWorker.worker.ts`, which made it hard to reason about reset lifecycles and caused the tagging persist timer to leak across loads. The new `src/workers/state/dataWorkerState.ts` module encapsulates dataset, options, and tagging slices behind a minimal API so feature code no longer reimplements life-cycle plumbing every time it needs fields from the worker.

### Key entrypoints

- `prepareDatasetForLoad()` – resets dataset metadata, assigns the active `RowBatchStore`, and associates the File System handle for the upcoming ingestion cycle.
- `updateDataset()` / `updateTagging()` – provide scoped mutators so the worker updates happen in one place while keeping consumers on read-only snapshots outside the closures.
- `hydrateTaggingStore()`, `markTaggingDirty()`, `persistTaggingNow()` – manage the OPFS tagging snapshot, debounce timer, and retry-safe persistence without exposing timer bookkeeping to the worker entrypoint.

Using the module keeps the worker shell thin: add new state by extending the controller, not by editing the main worker file. Tests in `src/workers/state/dataWorkerState.test.ts` cover the init → load → reset flow and debounce semantics so we can evolve the controller without manually verifying timing-sensitive code inside the worker.
