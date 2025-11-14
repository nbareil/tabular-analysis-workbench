# Session Persistence

csv-explorer keeps the “current session” (open file handle, filter tree, column layout, sort/group config, font preferences, etc.) inside the Origin Private File System (OPFS). This document explains how that controller works so the behaviour described in PRD §4.6 and TDD §§5.4, 6.5, 7.6, 8.2 can be maintained.

## High-level flow

1. **Dirty tracking** — `useSessionStore` timestamps every mutating call. `useSessionPersistence` subscribes to that `updatedAt` value so it knows when the in-memory snapshot changed.
2. **Auto-save cadence** — every 60 seconds (and on `beforeunload`) `useSessionPersistence` calls `saveSessionSnapshot`. The helper serialises the current `SessionSnapshot` while stashing the active `FileSystemFileHandle` in IndexedDB (see below).
3. **Restore on launch** — when the hook initialises it calls `loadSessionSnapshot`. If a snapshot exists, the associated file handle is resurrected and `useSessionStore.hydrate` replays the persisted layout before the worker is asked to reload the file.
4. **Status plumbing** — the hook exposes `{ restoring, lastSavedAt, error }` so the status bar can show “Restoring previous session…” and append “Auto-saved HH:MM:SS” once the flush succeeds.

## Storage layout

```
/opfs
 └── /sessions
      ├── latest.json              # envelope written every minute
      ├── snapshot-<timestamp>.json  # rolling history (max 3 files)
      └── (future) metrics, crash dumps
```

`latest.json` is an envelope with metadata so we can evolve the shape without breaking old snapshots:

```json
{
  "version": 1,
  "updatedAt": 1731576000000,
  "handleKey": "active-handle",   // null when no file open
  "snapshot": {
    "filters": [...],
    "columnLayout": {...},
    "groups": [...],
    "groupAggregations": [...],
    "sorts": [...],
    "searchCaseSensitive": false,
    "interfaceFontFamily": "inter",
    "interfaceFontSize": 15,
    "dataFontFamily": "ibm-plex-mono",
    "dataFontSize": 13,
    "labels": [],
    "tags": {},
    "updatedAt": 1731576000000
  }
}
```

### File handles

`FileSystemFileHandle` instances cannot be stringified, so we store them inside IndexedDB (`sessionHandleStore.ts`). `persistActiveFileHandle` replaces the sole `active-handle` record when a new file is opened and deletes it when the user clears the session. When `loadSessionSnapshot` detects a `handleKey`, it retrieves the handle and drops back to “missing handle” mode if permission was revoked (the hook then surfaces an error telling the user to reopen the file).

### History rotation

Before we overwrite `latest.json`, we copy the existing payload into a timestamped history file and prune to the most recent three entries. This makes it easier to recover after a corrupted write and keeps OPFS usage bounded (< 200 MB as per TDD §8.2).

## Behavioural guarantees

- Saves run at most once per minute unless the tab is closing; user interactions simply mark the session dirty.
- Restores only run when OPFS is available; otherwise the hook reports `supported: false` and the UI displays a reduced-functionality warning.
- When a restore contains filters or grouping config, helper hooks (`useFilterSync`, `useSortSync`, `useGrouping`) reapply them to the worker automatically once the dataset finishes loading. This ensures the hydrated view matches what was last saved.
- Errors are non-blocking: we log OPFS failures to the console and surface a footer warning while continuing to run in-memory.

## Extending the snapshot

1. Add the field to `SessionSnapshot` (mind the `PersistableSnapshot` type).
2. Update `useSessionStore` setters so `updatedAt` flips whenever the new field changes.
3. If the new field requires extra worker coordination (like filters or groups do), add/extend the corresponding hook to reapply state during hydrate.
4. Update this document so the envelope format stays accurate.
