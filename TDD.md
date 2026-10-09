# Technical Design Document -- Tabular Analysis Workbench

## 1. Purpose and scope
- Describes how the browser-native timeline explorer in `PRD.md` is built.
- Covers ingestion of CSV/TSV (optionally gzip) files, the worker query pipeline, tagging, preferences, and export within modern Chromium.
- Out of scope: remote file acquisition, multi-tab collaboration, non-Chromium browsers.

## 2. Requirements traceability
| PRD objective | Section | Notes |
|---|---|---|
| Stream large CSV/TSV files | 6.1, 7.1 | Streams API, worker batching, OPFS row cache |
| Chromium-only runtime | 3.1, 11 | Capability gate |
| Local-only operation | 12 | No network access |
| Filtering, sorting, grouping | 6.2, 7.3–7.5 | Serial worker view pipeline |
| Tagging and annotation | 6.4, 7.7 | Per-file OPFS snapshot |
| Persistent annotations | 8 | Labels/notes persist per file; view state is not restored |
| Exact no-match suggestions | 6.3, 7.6 | Worker-side suggestion pass |
| Data integrity | 7.1, 12 | Raw cell text is never altered; exports are copies |

## 3. Solution overview
### 3.1 Technology choices
- TypeScript (ES2022 target) bundled with Vite.
- React 18, Zustand stores, AG Grid Community (infinite row model).
- Comlink RPC to one long-lived data worker.
- Tailwind CSS with a dark-first theme.
- Storage: OPFS for the row cache and annotations; localStorage for preferences.

### 3.2 Runtime contexts
- Main thread: rendering, input, preferences, file pickers.
- Data worker (`src/workers/dataWorker.worker.ts`): parsing, storage, filter/search/sort/group, tagging, export.

## 4. High-level architecture
```
+---------------------------+      Comlink       +-------------------------------+
| React UI (main thread)    | <----------------> | Data worker                   |
| - App shell, status bar   |                    | - Ingestion pipeline          |
| - DataGrid (src/grid/*)   |                    | - RowBatchStore (raw text)    |
| - Filter builder, pivot   |                    | - View pipeline: filter →     |
| - Stores: app (prefs),    |                    |   search → sort (→ group)     |
|   session (view), data,   |                    | - Tagging controller          |
|   tag, undo               |                    +---------------+---------------+
+-------------+-------------+                                    |
              | localStorage: wlx:preferences, wlx:debug         | OPFS
              v                                                  v
                                              /row-cache/<dataset>-<uuid>/batch-NNNNNN.bin
                                              /annotations/tags-<dataset>.json
```

## 5. Component design
### 5.1 Bootstrap
- `App` checks capabilities (File System Access, Streams, OPFS, compression streams) and shows a blocking gate when a hard requirement is missing.
- `useWorkerBootstrap` initialises the worker and flushes pending label edits on `visibilitychange` (hidden).

### 5.2 UI layer
- Layout: top bar (search, row jump, open files, options, columns, labels, export, pivot, theme), collapsible filter sidebar, grid, status bar.
- Stores:
  - `appStore`: preferences persisted to localStorage (theme, fonts, search case sensitivity, display time zone).
  - `sessionStore`: view state of the open dataset (files, filters, sorts, groups, column layout). In memory only; reset when files are opened.
  - `dataStore`: load status, columns, counts, value distributions, grid navigation requests. `loadId` increments per load so late async results for a previous dataset are discarded.
  - `tagStore`: mirror of worker labels/notes; responses arriving after a file switch are dropped.
  - `undoStore`: undo/redo stack for filter and label edits.
- Grid (`src/components/DataGrid.tsx` + `src/components/grid/*`): AG Grid infinite model whose datasource is replaced whenever `viewVersion` changes. Selection is tracked in a row-id set so labelling and copying work for rows whose cache block was evicted. Header and cell context menus follow WAI-ARIA menu semantics.
- Datetime cells show the file's text by default; the display time zone preference converts parsed timestamps for display only.

### 5.3 Data worker modules
- `csvParser`: streaming state machine; header delimiter sniffing; quotes only special at field start; blank lines skipped; ragged rows padded or folded into the last column and counted.
- `typeInference` + `valueParsing`: strict parsers (see 7.2).
- `rowBatchStore`: raw-text batches in OPFS with lazy, memoised column decoding.
- `controllers/ingestionPipeline`: one or many files into one dataset.
- `controllers/viewController`: filter → search → sort pipeline.
- `filterEngine`, `sortEngine`, `groupEngine`, `columnStats`, `didYouMean`.
- `controllers/taggingController` + `taggingStore`.
- `state/dataWorkerState`: dataset/tagging state and the view-operation queue.

## 6. Data flow
### 6.1 File loading
1. The user picks one or more files with `showOpenFilePicker({ multiple: true })`.
2. The worker supersedes any in-flight load (it cancels the reader and discards that store) and creates a fresh `RowBatchStore` directory guarded by a Web Lock.
3. Each file is streamed; gzip is detected from the `1f 8b` magic bytes and piped through `DecompressionStream`.
4. Batches of 10,000 rows are written to OPFS; progress callbacks report rows and compressed bytes read.
5. With several files, columns are the union of their headers plus `source_file`; a column keeps an inferred type only if all files agree.
6. On completion the UI initialises the column layout, loads labels, and re-runs any active filter/search/sort so it covers every row.

### 6.2 View pipeline
1. The grid requests windows via `fetchRows(offset, limit)`; the worker maps positions through the active order (`sorted ?? searched ?? filtered ?? all rows`) and decodes only the requested cells.
2. `applyFilter`, `globalSearch`, `applySorts` and `groupBy` run one at a time in request order. Each request invalidates in-flight work on its own and later stages (filter > search > sort > group); superseded work rejects with `StaleOperationError`, which the UI ignores.
3. A filter recomputes the active search and sort; a search recomputes the sort. Results are committed together, so a cancelled operation never leaves a half-updated view.
4. Responses carry `matchedRows`; the UI bumps `viewVersion`, which gives the grid a new datasource.

### 6.3 Exact suggestions
- When a filter matches nothing, string equality predicates are checked against the column's values with a Damerau-Levenshtein threshold and up to five suggestions are returned. The result set is not changed.

### 6.4 Tagging
1. UI calls `tagRows`, `clearTag`, `restoreTags` (undo), `updateLabel`, `deleteLabel`, `importTags`.
2. The worker updates its in-memory map and saves the snapshot at most every 5 seconds, and immediately when the page is hidden or another file is opened. A failed save keeps the snapshot dirty and retries.

### 6.5 Export
- `exportCsv` builds a `Blob` from 10,000-row string chunks in the worker (no single giant string). Scopes: the current view, or only labelled/annotated rows (with `labels` and `note` columns). The main thread optionally gzips it with `CompressionStream` and saves it with `showSaveFilePicker`.
- Cells that a spreadsheet would treat as formulas (leading `= + - @`, tab, CR) are prefixed with `'` unless they are plain numbers.

## 7. Core algorithms
### 7.1 Storage model
- Every cell is stored as its original text (UTF-8 bytes plus Arrow-style offsets). Typed values are parsed on demand, so inference never loses data and per-batch type drift is impossible.
- Pure-ASCII columns are decoded with one `TextDecoder` call and sliced by offset.
- Up to 8 decoded batches are kept in memory. Without OPFS (tests), batches stay in memory up to 1 GiB.
- Row-cache directories are named `<dataset key>-<uuid>`; each load holds a Web Lock on its directory and every new load deletes directories whose lock is not held (closed tabs, finished loads).

### 7.2 Type inference and parsing
- Booleans: `true/false/yes/no/t/f/y/n` (not `1/0`).
- Numbers: plain decimal or exponent notation (no hex, no `Infinity`).
- Datetimes: `YYYY-MM-DD` or `YYYY/MM/DD`, optional `[T ]HH:MM[:SS[.fraction]]`, optional `Z`/`UTC`/`GMT`/`±HH[:MM]`. Missing zones mean UTC. Sub-millisecond digits are kept as a fraction. Integer epochs (10 or 13 digits) count only between 2000 and 2100.
- A column is typed when at least 90% of its non-empty values parse; otherwise it is text.

### 7.3 Filters
- Expressions are AND/OR trees compiled once per request; regular expressions are compiled once and patterns with nested quantifiers (e.g. `(a+)+`) are rejected to avoid catastrophic backtracking. Invalid patterns reject with a `FilterError` message shown to the user.
- Text operators (`eq` on text, `contains`, `startsWith`, regex) work on any column; `gt`/`lt`/`between` use the inferred type. `neq`/`notMatches` are exact complements, so empty cells are included. Blank range bounds are open.
- Equality filters on the same column are ORed; label filters likewise.

### 7.4 Sorting
- Keys are extracted once per sort column (`Float64Array` for typed columns, trimmed strings otherwise), then an index array is sorted. Empty or unparseable values sort last in both directions; ties keep file order; strings use `Intl.Collator` with numeric collation.

### 7.5 Grouping and statistics
- Grouping streams batch by batch over the filtered/searched rows, keyed by the JSON of the raw group values. Aggregates: count, count(column) of non-empty cells, sum/avg of numeric values, min/max by typed comparison (reported as the original text).
- `profileColumn` reports empties, invalid values, distinct count (capped at 100,000), min/max, mean, text lengths and top values. `getTimeHistogram` buckets parsed timestamps of the current view.

### 7.6 Exact-value suggestions
- Only for string equality predicates in a filter that matched zero rows. Ranking: distance, then frequency, then value.

### 7.7 Annotations
- `Record<rowId, { labelIds: string[]; note?: string; updatedAt }>`, keyed by the stable row number of the dataset.
- Imports merge labels into existing records, ignore row ids outside the dataset, and reject exports whose recorded row count differs from the open dataset.
- Markdown notes are rendered through `marked` + DOMPurify; links open in a new tab.

## 8. Storage layout
```
OPFS
  /row-cache/<dataset key>-<uuid>/batch-000000.bin   // [u32 header length][JSON header][offsets+bytes per column]
  /annotations/tags-<dataset key>.json               // { labels, tags }
localStorage
  wlx:preferences   // theme, fonts, search case sensitivity, display time zone
  wlx:debug         // debug logging flag
```
- The dataset key is derived from the file names, total size and latest modification time.
- Annotation snapshots of datasets not opened for 21 days (by file `lastModified`; opening a dataset re-saves its snapshot) are deleted when another dataset is opened.
- **Options → Delete stored data** removes every OPFS entry and `wlx:` key and reloads.

## 9. UI and UX details
- Keyboard: `/` or Ctrl/Cmd+K search; Enter/Shift+Enter in search moves to the next/previous match; `g` row number; `f` filter panel; `a` add filter; Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z undo/redo; in the grid, arrows move (Shift extends the selection), Space toggles selection, `T` edits the focused row's labels/note, `[`/`]` jump to the previous/next labelled row.
- Grid context menu: copy rows/cell, filter in/out, filter a time window around a timestamp, labels, hide column. Header menu: hide, profile column, timeline histogram, value counts with checkbox filters.
- Status bar: row counts, active scopes, label filter summary, streaming progress, malformed row count, browser storage usage.

## 10. Performance
- Parser scans with `charCodeAt`/`indexOf` and substring slicing, awaiting only at batch boundaries.
- Fetching a grid window decodes only the requested cells; scans decode each needed column once per batch.
- Grouping and statistics are streamed; only histograms keep one number per dated row.

## 11. Error handling
- Load failures mark the load as failed and show the reason; other errors open the diagnostics toast (with an optional JSON download) without changing the load state.
- Superseded requests (`StaleOperationError`) are silent.
- Capability gate blocks browsers without the required APIs.

## 12. Security and privacy
- No network access besides loading the bundled assets.
- Markdown sanitised with DOMPurify; grid cells render as text.
- CSV exports neutralise spreadsheet formulas.
- Preferences only in localStorage.

## 13. Testing strategy
- Vitest unit tests: parser edge cases (quotes, chunk boundaries, delimiters, BOM, ragged rows), strict parsing (run with `TZ=Europe/Paris` to catch local-time bugs), filter/sort/group semantics, stores and hooks.
- Worker integration tests run the worker API in Node with the in-memory store: loading, merging, superseded requests, view pipeline, tagging persistence, export.
- Component tests with Testing Library for menus, dialogs, shortcuts and the filter builder.
- CI runs lint, type check, tests and build on every push and pull request.
- Not yet automated: Playwright end-to-end tests, large-file performance benchmarks, axe accessibility audits (tracked in bd).

## 14. Tooling
- npm with `package-lock.json`; Node 22 (also provided by `nix develop`).
- ESLint flat config with `typescript-eslint`, React hooks and jsx-a11y rules.
- GitHub Actions: CI on pushes and pull requests; GitHub Pages deploy from `main`.

## 15. Open questions
- Whether repeated filter/search workloads need additional indexing once real-world datasets are profiled.
- Fuzzy (typo-tolerant) fallback search from the PRD is not implemented yet; it is tracked in bd.
