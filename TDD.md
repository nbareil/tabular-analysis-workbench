# Technical Design Document -- Tabular Analysis Workbench

## 1. Purpose and scope
- Describes how the browser-native timeline explorer in `PRD.md` is built.
- Covers ingestion of CSV/TSV and JSON Lines (optionally gzip) files, the worker query pipeline, tagging, preferences, and export within modern Chromium.
- Out of scope: remote file acquisition, multi-tab collaboration, non-Chromium browsers.

## 2. Requirements traceability
| PRD objective | Section | Notes |
|---|---|---|
| Stream large CSV/TSV and JSON Lines files | 6.1, 7.1, 7.2 | Streams API, worker batching, OPFS row cache |
| Chromium-only runtime | 3.1, 11 | Capability gate |
| Local-only operation | 12 | No network access |
| Filtering, sorting, grouping | 6.2, 7.4–7.6 | Serial worker view pipeline |
| Tagging and annotation | 6.4, 7.8 | Per-file OPFS snapshot |
| Persistent annotations | 8 | Labels/notes persist per file; view state is not restored |
| Exact no-match suggestions | 6.3, 7.7 | Worker-side suggestion pass |
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
- `utils/detectFormat`: picks the parser from the first bytes of each (decompressed) file.
- `csvParser`: streaming state machine; header delimiter sniffing; quotes only special at field start; blank lines skipped; ragged rows padded or folded into the last column and counted.
- `jsonLinesParser`: one row per line, flattened by a single-pass scanner (see 7.2).
- `typeInference` + `valueParsing`: strict parsers (see 7.3).
- `rowBatchStore`: raw-text batches in OPFS with lazy, memoised column decoding; mostly-empty columns are stored sparse.
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
4. The first byte that is not whitespace or a byte order mark picks the parser: `{` starts JSON Lines, unless nothing else is on its line; that line, or a leading `[`, marks a JSON document, which fails the load with a hint to convert it; anything else is delimited text.
5. Batches of 10,000 rows are written to OPFS; progress callbacks report rows and compressed bytes read.
6. `onColumns` reports every column before the first batch, and again before any batch that adds columns (JSON Lines keys that first appear late). Types inferred so far stay in place while the UI handles the callback, because a filter may run meanwhile.
7. With several files, columns are the union of each file's columns plus `source_file`; a column keeps an inferred type only if all files agree.
8. On completion the UI initialises the column layout from the final column order, loads labels, and re-runs any active filter/search/sort so it covers every row.

### 6.2 View pipeline
1. The grid requests windows via `fetchRows(offset, limit)`; the worker maps positions through the active order (`sorted ?? searched ?? filtered ?? all rows`) and decodes only the requested cells.
2. `applyFilter`, `globalSearch`, `applySorts` and `groupBy` run one at a time in request order. Each request invalidates in-flight work on its own and later stages (filter > search > sort > group); superseded work rejects with `StaleOperationError`, which the UI ignores.
3. A filter recomputes the active search and sort; a search recomputes the sort. Results are committed together, so a cancelled operation never leaves a half-updated view.
4. Responses carry `matchedRows`; the UI bumps `viewVersion`, which gives the grid a new datasource.

### 6.3 Exact suggestions
- When a filter matches nothing, string equality predicates are checked against the column's values with a Damerau-Levenshtein threshold and up to five suggestions are returned. The result set is not changed.

### 6.4 Tagging
1. UI calls `tagRows`, `clearTag`, `restoreTags` (undo), `updateLabel`, `deleteLabel`, `importTags`.
2. The worker updates its in-memory map and saves the snapshot 300 ms after the last edit, and immediately when the page is hidden or another file is opened. Saves run one at a time. A failed save keeps the snapshot dirty and retries after 5 seconds. (The worker dies on unload before an async write can commit, so the short delay is what bounds data loss when a tab closes.)

### 6.5 Export
- `exportCsv` builds a `Blob` from 10,000-row string chunks in the worker (no single giant string). Scopes: the current view, or only labelled/annotated rows (with `labels` and `note` columns). The main thread optionally gzips it with `CompressionStream` and saves it with `showSaveFilePicker`.
- Cells that a spreadsheet would treat as formulas (leading `= + - @`, tab, CR) are prefixed with `'` unless they are plain numbers.

## 7. Core algorithms
### 7.1 Storage model
- Every cell is stored as its original text (UTF-8 bytes plus Arrow-style offsets). Typed values are parsed on demand, so inference never loses data and per-batch type drift is impossible.
- Each column of a batch is encoded with one `TextEncoder` call; offsets come from string lengths, or from UTF-8 lengths when the column is not pure ASCII.
- Pure-ASCII columns are decoded with one `TextDecoder` call and sliced by offset.
- A column with a value in fewer than half the rows of a batch is stored sparse: only those cells, plus their row numbers in the batch (`rows`). Other rows read as empty. Batch views expose `column()` (one cell per row) and `cells()` (stored cells only); global search uses `cells()`, so a wide, sparse file costs what it stores.
- Up to 8 decoded batches are kept in memory. Without OPFS (tests), batches stay in memory up to 1 GiB.
- Row-cache directories are named `<dataset key>-<uuid>`; each load holds a Web Lock on its directory and every new load deletes directories whose lock is not held (closed tabs, finished loads).

### 7.2 JSON Lines
- Lines are split on LF and each one is flattened in a single pass, without building objects, by a scanner that accepts exactly what `JSON.parse` accepts.
- Nested objects become dotted paths. A path tree keeps each object's keys in first-seen order, and columns are reported in tree order, so keys that share a parent stay together however late they first appear.
- Arrays, and objects nested more than 20 levels deep, keep their source text. Numbers and booleans keep their literal text, so 64-bit ids and trailing zeros survive. Strings are unescaped. `null` is an empty cell, an empty nested object is `{}`, and a repeated key keeps its last value.
- A line that is not a JSON object becomes a row holding its text (without a trailing CR) in `malformed_line` and counts as malformed. Blank lines are skipped.
- Paths get columns until a file has 1,000 of them; after that, the values of new paths are stored per row as a JSON object in `other_fields`, and the path tree stops growing. A name that is already taken (a key containing a dot, `source_file` in a merge) gets a suffix, as delimited headers do.
- Path keys and type-inference examples are copied out of the decoded text: V8 keeps a whole string alive while any slice of it lives, so a few kept slices could pin every decoded chunk.

### 7.3 Type inference and parsing
- Booleans: `true/false/yes/no/t/f/y/n` (not `1/0`).
- Numbers: plain decimal or exponent notation (no hex, no `Infinity`).
- Datetimes: `YYYY-MM-DD` or `YYYY/MM/DD`, optional `[T ]HH:MM[:SS[.fraction]]`, optional `Z`/`UTC`/`GMT`/`±HH[:MM]`. Missing zones mean UTC. Sub-millisecond digits are kept as a fraction. Integer epochs (10 or 13 digits) count only between 2000 and 2100.
- A column is typed when at least 90% of its non-empty values parse; otherwise it is text.
- A JSON Lines row without a key counts as empty for that column, and a column added mid-file counts every earlier row as empty.

### 7.4 Filters
- Expressions are AND/OR trees compiled once per request; regular expressions are compiled once and patterns with nested quantifiers (e.g. `(a+)+`) are rejected to avoid catastrophic backtracking. Invalid patterns reject with a `FilterError` message shown to the user.
- Text operators (`eq` on text, `contains`, `startsWith`, regex) work on any column; `gt`/`lt`/`between` use the inferred type. `neq`/`notMatches` are exact complements, so empty cells are included. Blank range bounds are open.
- Equality filters on the same column are ORed; label filters likewise.

### 7.5 Sorting
- Keys are extracted once per sort column (`Float64Array` for typed columns, trimmed strings otherwise), then an index array is sorted. Empty or unparseable values sort last in both directions; ties keep file order; strings use `Intl.Collator` with numeric collation.

### 7.6 Grouping and statistics
- Grouping streams batch by batch over the filtered/searched rows, keyed by the JSON of the raw group values. Aggregates: count, count(column) of non-empty cells, sum/avg of numeric values, min/max by typed comparison (reported as the original text).
- `profileColumn` reports empties, invalid values, distinct count (capped at 100,000), min/max, mean, text lengths and top values. `getTimeHistogram` buckets parsed timestamps of the current view.

### 7.7 Exact-value suggestions
- Only for string equality predicates in a filter that matched zero rows. Ranking: distance, then frequency, then value.

### 7.8 Annotations
- `Record<rowId, { labelIds: string[]; note?: string; updatedAt }>`, keyed by the stable row number of the dataset.
- Imports merge labels into existing records, ignore row ids outside the dataset, and reject exports whose recorded row count differs from the open dataset.
- Markdown notes are rendered through `marked` + DOMPurify; links open in a new tab.

## 8. Storage layout
```
OPFS
  /row-cache/<dataset key>-<uuid>/batch-000000.bin   // [u32 header length][JSON header][offsets+bytes(+row numbers if sparse) per column]
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
- Themes: components are styled dark-first with Tailwind palette utilities; light mode (`html:not(.dark)` in `global.css`) mirrors every palette the UI uses, so one class list serves both themes. Text on fixed colours (the accent) uses fixed tokens, and scrims are always black.
- Status bar: row counts, active scopes, label filter summary, streaming progress, malformed row count, browser storage usage.

## 10. Performance
- Parsers scan with `charCodeAt`/`indexOf` and substring slicing, awaiting only at batch boundaries.
- Encoding a batch makes one `TextEncoder` call per column, not one per cell.
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
- Vitest unit tests: parser edge cases (quotes, chunk boundaries, delimiters, BOM, ragged rows), JSON Lines flattening (property tests compare it with `JSON.parse` on random and mutated lines), strict parsing (run with `TZ=Europe/Paris` to catch local-time bugs), filter/sort/group semantics, stores and hooks.
- Worker integration tests run the worker API in Node with the in-memory store: loading, merging, superseded requests, view pipeline, tagging persistence, export.
- Component tests with Testing Library for menus, dialogs, shortcuts and the filter builder.
- CI runs lint, type check, unit tests, build and the Playwright suite on every push and pull request.
- Playwright end-to-end tests (`e2e/`) drive the real app in Chromium. The native file pickers are replaced with OPFS file handles, so loading, filtering, labelling (including persistence across a reload), notes, export and error paths run unattended. Any uncaught page error fails the test.
- axe-core audits (WCAG 2.1 A/AA) run in the same suite on the start screen, the loaded grid with a filter, menus, the timeline and every dialog, in both themes.

## 14. Tooling
- npm with `package-lock.json`; Node 22 (also provided by `nix develop`).
- ESLint flat config with `typescript-eslint`, React hooks and jsx-a11y rules.
- GitHub Actions: CI on pushes and pull requests; GitHub Pages deploy from `main`.

## 15. Open questions
- Whether repeated filter/search workloads need additional indexing once real-world datasets are profiled.
