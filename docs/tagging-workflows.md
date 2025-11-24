# Tagging & Annotation Design

This document captures the concrete data structures, persistence strategy, and user-facing workflows for the tagging system described in PRD §4.4 and TDD §§7.7–8. It provides the implementation contract that the worker, state stores, and UI panels rely on.

## Goals
- Allow analysts to assign reusable labels and optional markdown notes to any row streamed from a dataset.
- Persist label catalogs and per-row annotations in OPFS so sessions survive reloads and system restarts.
- Expose bulk edit affordances (grid context menu, multi-select batches) with undo-friendly responses.
- Support export/import of annotations for sharing, while keeping original data files untouched.
- Keep the main thread responsive by delegating mutation-heavy work to the long-lived data worker.

## Data Model

### Core Types

```ts
type RowId = number; // aliases the __rowId emitted by materializeRowBatch

interface LabelDefinition {
  id: string;          // stable UUID (worker generates if absent)
  name: string;        // analyst-facing label text
  color: string;       // hex or hsl string
  description?: string;
  createdAt: number;   // epoch ms
  updatedAt: number;   // epoch ms
}

interface TagRecord {
  labelIds: string[];     // zero or more labels assigned to the row
  note?: string;          // markdown stored raw, sanitised on render
  updatedAt: number;      // epoch ms
}

interface TaggingSnapshot {
  labels: LabelDefinition[];
  tags: Record<RowId, TagRecord>;
}
```

### Derived Views
- **TagStats** (main thread only): aggregate counts per label to surface badge totals and audit unused labels.
- **RowAnnotation**: local memo combining `TagRecord` with row metadata for tooltip/panel rendering.
- **LabelPalette**: ordered list of label IDs persisted with the session to keep color pickers consistent.

## Storage Strategy

| Layer | Responsibility |
|-------|----------------|
| Worker memory (`state.tagging`) | Authoritative copy of labels + row tags during a session. |
| Zustand store (`useTagStore`) | UI-facing cache, populated via worker RPC. Handles optimistic updates and exposes async helpers to components. |
| OPFS (`/annotations`) | Durable storage scoped by dataset fingerprint (file name + size + mtime). Files are written atomically with temp/replace to avoid tearing: <br>• `tags-<fingerprint>.json` → combined `TaggingSnapshot` keyed to the CSV version <br>• Future: `history.jsonl` for audit trail if undo/redo becomes persistent. |
| Session snapshot (`SessionState`) | Stores tag palette + visibility preferences, but **not** the full tag map (to avoid duplication). |

Persisted files follow versioned envelopes:

```json
{
  "version": 1,
  "updatedAt": 1730540000000,
  "payload": { "...": "..." }
}
```

The worker decides when to flush based on dirty flags and a debounce window (default 5 s, forced flush on page unload).

## Worker API Contract

Existing RPC endpoints are extended/implemented as follows (all live in `DataWorkerApi`):

| Method | Behaviour | Notes |
|--------|-----------|-------|
| `loadTags()` | Read OPFS envelopes, fall back to empty snapshot if files are missing or OPFS unavailable. | Should gate on capability detection to avoid throwing in unsupported browsers. |
| `tagRows({ rowIds, labelIds, note, mode })` | Update or create `TagRecord` for each `rowId`. Returns `{ updated }` map for optimistic UI updates. | `mode` defaults to `replace`; `append` unions incoming labels; `remove` subtracts them. When `note` is omitted, retain the prior note. |
| `clearTag(rowIds)` | Remove tag + note for each row. Returns `{ updated }` entries with `labelIds: []`. | Used for "Clear tag" UX and for label deletion cascading. |
| `updateLabel({ label })` | Upsert label, normalising timestamps and ensuring color defaults. Returns canonical `LabelDefinition`. | When color absent, auto-generate via palette helper. |
| `deleteLabel({ labelId })` | Delete label and clear any rows referencing it. Returns `{ deleted: boolean }`. | Emits updates for affected rows so UI badge counts stay accurate. |
| `exportTags()` | Return `TaggingSnapshot` plus `exportedAt` timestamp for download helpers. | UI serialises to JSON blob and triggers save dialog. |
| `importTags({ labels, tags, mergeStrategy })` | Merge or replace worker state, returning the reconciled snapshot. | Merge strategy `replace` drops existing state after backup; `merge` honours incoming IDs, generating UUIDs for conflicts. |
| `persistTags()` *(new internal)* | Write latest snapshot to OPFS. Respects in-flight debounce; exposed only for tests/teardown. |

All mutating calls raise `taggingDirty = true`, and a single persistence scheduler (setTimeout / AbortController) handles batching writes.

## Main-Thread Integration

`useTagStore` wraps worker calls and keeps UI state in sync:

- `load()` lazily hydrates on first panel open or when a dataset is loaded.
- `applyTag`, `clearTag`, `upsertLabel`, and `deleteLabel` call worker methods and merge responses into local state before returning results to callers.
- `exportTags` / `importTags` surface worker snapshots for download/upload flows.
- `status` field enables components to show loading/error/ready states.
- Errors from worker RPCs are flattened into strings and stored in `error` for toast rendering.

Future enhancements:
- Add `observeTagUpdates` stream so grid badges update without polling once we allow external triggers (e.g., collaborative edit or undo stack).
- Hook into `useDataStore` so row decorations re-render when tags change.

## UI Workflows

### Hydration
1. Dataset load completes.
2. UI opens Labels panel or grid requests tag metadata.
3. `useTagStore.load()` invokes `worker.loadTags()`.
4. Snapshot populates label catalog + tag map; status flips to `ready`.

### Status feedback
- The footer status bar appends a label filter summary so analysts always see which labels are included or excluded in the current view.

### Creating a Label
1. User enters label name + optional color.
2. `upsertLabel` generates UUID client-side if none provided.
3. Worker normalises timestamps and persists to in-memory catalog.
4. Response updates Zustand store; debounce writes OPFS envelope.

### Tagging Rows
1. Analysts select rows via the pinned label column (checkboxes w/ header select respect filters) or Cmd/Ctrl-click multi-select.
2. Caller supplies the deduped list of `RowId`s and the selected `labelIds` (one or many).
3. Worker maps each row to `{ labelIds, note, updatedAt }`.
4. Response's `updated` map merges into UI store, triggering grid highlight + status bar counts plus context-menu feedback showing the batch size.
5. Persistence scheduler flushes the dataset-scoped snapshot to OPFS.

### Adding / Editing Notes
- Notes share the same `tagRows` request body (`note` field). UI should pass the full `labelIds` set (and `mode: 'replace'`) to avoid stripping labels.
- Markdown is stored raw; renderer must sanitise with DOMPurify before injecting into DOM (tracked via csv-explorer-91da).
- Analysts can open the inline note editor from the grid label column context menu; changes persist via the worker and propagate back through `useTagStore`.

### Clearing Tags
- Either call `clearTag` (bulk) or `tagRows` with `labelIds: []`.
- Worker deletes entries from `state.tagging.tags` and returns tombstones so cache can drop them.

### Deleting Labels
1. UI confirms destructive action.
2. `worker.deleteLabel` removes the label and cascades row updates to `labelIds: []`.
3. Response drives UI updates and surfaces number of affected rows in a toast.

### Export / Import
- Export: UI calls `exportTags`, receives a versioned envelope `{ version, exportedAt, source, payload }`, stringifies it (pretty-print optional), and writes via `showSaveFilePicker`.
- Import: UI reads JSON, validates the envelope (while still accepting legacy snapshot-only files), then calls `importTags`. On success, replace local store and notify the user with counts + source metadata.
- Both flows leave original dataset untouched, satisfying PRD §4.7.

## Persistence & Scheduling

- Dirty writes are buffered; the default debounce is 5 seconds, reset on every mutation.
- On `beforeunload` the main thread calls `worker.persistTags()` (if available) to avoid losing the last few edits.
- Session clearing or loading a new dataset triggers `worker.importTags({ labels: [], tags: [], mergeStrategy: 'replace' })` before releasing the file handle.

## Error Handling

- Worker wraps OPFS failures (permission revoked, quota exceeded) and returns structured errors so UI can display actionable toasts.
- When OPFS is unavailable, tagging still works in-memory; persistence toggles show "Not saved" warning and export remains available.
- Tagging operations should be idempotent: retrying `tagRows` with the same payload produces the same state.

## Dependencies & Follow-up Issues

- csv-explorer-bd68: Implements the stubbed UI, tying badge rendering + panels into the worker contract defined here.
- csv-explorer-8ad2: Adds OPFS persistence and flush scheduling on top of this design.
- csv-explorer-91da: Introduces DOMPurify sanitisation for note rendering.
- csv-explorer-26e3: Extends the status bar to surface tag counts and persistence health.

This document should remain the source of truth for tagging interactions; update it alongside any future schema or workflow changes.
