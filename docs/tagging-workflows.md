# Tagging and annotation

How labels and notes work across the worker, the stores and the UI (PRD §4.4, TDD §7.7).

## Data model

```ts
type RowId = number; // stable row number within the open dataset (0-based)

interface LabelDefinition {
  id: string;          // UUID
  name: string;
  color: string;       // CSS colour
  description?: string;
  createdAt: number;   // epoch ms
  updatedAt: number;
}

interface TagRecord {
  labelIds: string[];  // any number of labels
  note?: string;       // markdown, stored raw and sanitised on render
  updatedAt: number;
}

interface TaggingSnapshot {
  labels: LabelDefinition[];
  tags: Record<RowId, TagRecord>;
}
```

A dataset without a saved snapshot starts with the MITRE ATT&CK tactic labels (`src/constants/mitreAttackTactics.ts`).

## Where state lives

| Layer | Role |
|---|---|
| Worker (`state.tagging`) | Authoritative labels and records for the open dataset. |
| `useTagStore` | UI mirror. Every worker call goes through one helper that drops the response if another dataset was opened meanwhile (`dataStore.loadId` changed). |
| `useUndoStore` | Records the before/after records of each label edit so Ctrl/Cmd+Z can restore them via `restoreTags`. |
| OPFS `/annotations/tags-<dataset key>.json` | The `TaggingSnapshot` as plain JSON. The dataset key comes from the file names, total size and latest modification time. |

## Persistence

- Mutations mark the snapshot dirty. The worker saves 300 ms after the last edit, and immediately when another dataset is opened or the page becomes hidden (`visibilitychange`). Saves are serialised, so the last edit always lands last.
- Closing or reloading the tab kills the worker before an OPFS write started at that moment can commit; the short debounce is what keeps the loss window under a second.
- `createWritable()` writes to a swap file that atomically replaces the snapshot on `close()`, so an interrupted write leaves the previous snapshot intact.
- A failed save keeps the snapshot dirty and is retried.
- Opening a dataset re-saves its snapshot (restarting its retention clock) and deletes snapshots of other datasets whose file was last modified more than 21 days ago.

## Worker API

| Method | Behaviour |
|---|---|
| `loadTags()` | Current snapshot of the open dataset. |
| `tagRows({ rowIds, labelIds, note, mode })` | `mode`: `replace` (default) sets labels, `append` adds them, `remove` subtracts them. Omitting `note` keeps the current note. Unknown label ids are dropped. Returns `{ updated }`. |
| `clearTag(rowIds)` | Removes labels and notes. |
| `restoreTags(records)` | Sets records verbatim (`null` deletes); used by undo/redo. |
| `updateLabel({ label })` | Creates or updates a label. |
| `deleteLabel({ labelId })` | Deletes the label and removes it from every row; returns the affected records. |
| `exportTags()` | `{ version, exportedAt, source: { fileName, rowCount }, payload }`. |
| `importTags({ labels, tags, mergeStrategy, source })` | `merge` keeps existing labels and adds imported labels to existing rows; `replace` discards current state. Row ids that are not integers within the dataset are ignored. If `source.rowCount` differs from the open dataset the import is rejected, because row numbers would not line up. |
| `persistTags()` | Saves now if dirty. |

## UI workflows

- **Apply labels:** select rows (checkboxes, click, Shift+Arrow), right-click the Labels column and pick a label. It applies to the whole selection, including rows scrolled out of AG Grid's cache.
- **Edit a note:** context menu → *Edit note…*, or press `T` with a row focused. The note editor saves labels and note together (`mode: 'replace'`).
- **Navigate:** `]` / `[` jump to the next/previous labelled or annotated row in the current view.
- **Filter:** label filters (`eq` / `neq`, or *no label*) in the filter builder or via *Filter in/out* on the Labels column. Several label equality filters are ORed. The status bar summarises active label filters.
- **Undo:** Ctrl/Cmd+Z undoes the last label or filter edit; Ctrl/Cmd+Shift+Z redoes it. History resets when another dataset is opened.
- **Export:** *Export → All labels & notes (.json)* for sharing; *Export → All labelled rows* writes those rows as CSV with `labels` and `note` columns. Both ignore filters and search: the JSON is keyed by row number and is also a backup, so a partial export followed by a *replace* import would silently drop annotations. Use *Rows in current view* for a filtered subset.
- **Editing surfaces:** labels are applied inline (Labels column context menu, applies to the selection) because it is the frequent, quick action; notes are edited in the side panel because markdown needs room and a preview.
- **Import:** Labels panel → import JSON, choosing merge or replace.
- Notes render through `marked` + DOMPurify; links open in a new tab so the session is not lost.
