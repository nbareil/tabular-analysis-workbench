# Technical Design Document -- Web Timeline Explorer

## 1. Purpose & Scope
- Provide a detailed implementation plan for the browser-native timeline explorer described in PRD v1.2.
- Cover CSV/TSV ingestion, interactive exploration (filtering, grouping, tagging, fuzzy search), and session persistence within modern Chromium.
- Explicitly exclude remote file acquisition, multi-tab collaboration, and non-Chromium support (captured as future enhancements in PRD section 12).

## 2. Requirements Traceability
| PRD objective | TDD coverage | Notes |
|---------------|--------------|-------|
| Stream large CSV/TSV files (goal section 3 objective 1) | section 7.1, section 7.3 | Streams API, worker batching, byte index |
| Chromium-only runtime (goal section 3 objective 2) | section 3.1, section 10 | Chromium feature detection, fallbacks |
| Local-only operation (goal section 3 objective 3) | section 3.1, section 12 | No network dependencies, in-browser persistence |
| Filtering/sorting/grouping (goal section 3 objective 5) | section 7.4, section 7.5, section 6.2 | Worker-side query engine, optional DuckDB |
| Tagging and annotation (goal section 3 objective 6) | section 7.7, section 8 | OPFS-backed tag map plus UI |
| Persistent sessions (goal section 3 objective 7) | section 7.6, section 6.4 | OPFS layout, auto-save scheduler |
| Fuzzy fallback search (goal section 3 objective 8) | section 7.6, section 6.3 | Damerau-Levenshtein worker module |
| Data integrity (goal section 3 objective 9) | section 12 | Read-only file handles, export copies |

## 3. Solution Overview
### 3.1 Technology choices
- Language and toolchain: TypeScript targeting ES2022, bundled with Vite for fast development cycles and Chromium-optimized output.
- UI framework: React 18, React Router for single-page shell, Zustand for lightweight state sharing, and AG Grid Community (MIT) for virtualized grid and grouping support.
- Worker tooling: Dedicated TypeScript build via Vite worker entry, using Comlink to simplify postMessage interactions while supporting transferable objects.
- Styling: Tailwind CSS with custom dark-first theme tokens and CSS variable fallback.
- Storage APIs: Origin Private File System (OPFS) for persistent session artifacts and annotations plus localStorage for lightweight preferences. IndexedDB is not required.

### 3.2 Runtime contexts and threading
- Main thread: handles UI rendering, user events, session orchestration, and OPFS scheduling.
- Data worker: long-lived worker implementing parser, indexing, query execution, fuzzy search, and optional DuckDB harness.
- Export worker (optional): spawned on demand for large export jobs to prevent UI stalls and reuses parser utilities.
- Message channels: Each worker communicates via MessageChannel ports managed by Comlink to structure requests and propagate transferable ArrayBuffers.

### 3.3 External dependencies and polyfills
- ag-grid-community for virtualized grid and grouping UI.
- comlink for worker RPC.
- duckdb-wasm (standalone build) loaded behind a feature toggle.
- fastest-levenshtein or custom Damerau-Levenshtein implementation for fuzzy search.
- No third-party network services; all dependencies bundled.

## 4. High-Level Architecture
```
+-------------------+        MessageChannel        +------------------------+
| React UI (main)   | <--------------------------> | Data Worker            |
| - App shell       |                              | - Stream parser        |
| - Grid + panels   |                              | - Row index cache      |
| - Command palette |                              | - Query/fuzzy engines  |
+---------+---------+                              +-----------+------------+
          |                                                     |
          |                              OPFS (File System Access API)
          |                                                     |
          v                                                     v
+-------------------+                                +--------------------+
| localStorage      |                                | OPFS directories   |
| - theme toggle    |                                | - sessions.json    |
| - onboarding flag |                                | - row_index.bin    |
+-------------------+                                | - tags.json        |
                                                     +--------------------+
```

## 5. Component Design
### 5.1 Application bootstrap
- Entry point mounts React app after verifying Chromium capabilities (File System Access, Streams, OPFS). Unsupported browsers receive a blocking warning screen.
- Initializes global stores (useAppStore, useSessionStore) and establishes the long-lived data worker via Comlink, passing feature flags such as gzip support and duckdb availability.

### 5.2 UI layer
- Layout: Top bar (file picker, global search, export, theme), left sidebar (column controls), main grid, bottom status bar.
- State management: Zustand slices hold view state (selected rows, filter forms, fuzzy mode) decoupled from persisted session state to simplify serialization boundaries.
- Grid implementation: AG Grid infinite row model configured with a custom data source adapter that requests row windows from the worker. Column definitions incorporate metadata (type, inferred format, aggregations).
- Grid context menu: right-clicking any populated cell surfaces **Filter in** / **Filter out** actions that append or update filter predicates using shared filter-sync utilities so worker pipelines stay consistent with the filter builder; the default browser menu is suppressed to keep interactions within the app shell.
- Dialogs and panels: Modular React components for filter builder, note editor (markdown with preview), and fuzzy search banner. Filter builder enumerates predicate operators including regex-specific **matches** / **not matches** entries and exposes a per-predicate **Case sensitive** checkbox (default off).
- Top bar ships a Columns dialog exposing column visibility toggles synced with session layout; sidebar collapse toggle maximises workspace.
- Filter sidebar includes collapse toggle to increase horizontal workspace; state synced in session store.
- Global search control pairs the query input with a **Case sensitive** toggle that persists in session storage; searches run insensitive by default and recompute automatically when the toggle changes.
- Typography variables cascade via CSS custom properties so interface and data grid can honor independent font families and sizes.

### 5.3 Data worker
- Structured modules:
  - Parser: orchestrates stream decoding, delimiter detection, row batching, and type inference.
  - RowIndex: maintains byte-offset index, OPFS cache sync, and random-access fetch helpers.
  - QueryEngine: executes filter, sort, and group operations using typed column vectors and delegates to DuckDB when advanced aggregations are requested.
  - FuzzyEngine: manages per-column token dictionaries, trigram indexes, and Levenshtein scoring fallback.
  - AnnotationStore: in-memory view of tag and note map synchronized with OPFS.
- Supported commands include loadFile, applyFilter, updateTag, exportRequest, each returning structured responses with success or error metadata.

### 5.4 Persistence and session controller
- Session controller in main thread coordinates periodic saves by batching dirty flags from UI and worker. OPFS writes are throttled via requestIdleCallback or timeout fallback at a one-minute cadence.
- Storage layout is detailed in section 8.

### 5.5 Optional DuckDB module
- DuckDB-WASM loads lazily when grouping or complex aggregations are first requested or when filters exceed local engine capabilities.
- Uses duckdb.browser.js AsyncDuckDB variant stored in the DuckDB virtual filesystem; we wrap custom table registration to feed incoming row batches incrementally without duplicating the entire dataset.
- Fallback: built-in query engine covers comparisons, ranges, boolean logic, and regex via RE2-wasm if profiling shows need; otherwise use native JavaScript regex.

### 5.6 Options and preferences panel
- Accessible from top bar "Options" button; renders headless modal overlay.
- Relies on session store slice for persisted session preferences (interface/data font families and sizes, searchCaseSensitive, etc.).
- Font pickers enumerate stacks defined in `constants/fonts.ts` and update CSS variables `--app-font-family`, `--app-font-size`, `--data-font-family`, and `--data-font-size` for immediate reflow.
- Panel designed as extensible list of sections so new toggles (density, timezone) can be appended without altering layout.

## 6. Data Flow
### 6.1 File loading
1. User selects file via showOpenFilePicker.
2. Main thread obtains FileSystemFileHandle and passes it to worker.
3. Worker opens readable stream (handle.getFile().stream()), wrapping with DecompressionStream('gzip') when the extension ends with .gz.
4. Parser decodes text using TextDecoder in streaming mode, detecting delimiter and header by sampling the first chunk.
5. Rows emit in batches of 50,000 along with cumulative byte offsets and inferred schema metadata.
6. UI receives progressive metadata updates (columns, estimated row count) to initialize grid while parsing continues asynchronously.

### 6.2 Paging, filtering, and sorting loop
1. Grid requests window [offset, limit].
2. Worker consults row index to convert row window to byte range and replays partial parse if needed via cached line offsets.
3. Filters and sorts apply on column vectors before packaging result into transferable ArrayBuffers.
4. UI renders the batch and updates status bar metrics.
5. Filter changes trigger applyFilter command; worker updates active predicate tree, invalidates caches, and notifies UI to refresh.
6. Context menu shortcuts on grid cells generate equality or inequality predicates and dispatch them through the same filter-sync helper, ensuring filter builder state and worker expression remain in lockstep.
7. Global search requests include the persisted case-sensitivity flag so worker-side string comparisons normalise appropriately.

### 6.3 Fuzzy fallback flow (PRD section 3.3.a)
1. User applies filter; worker executes and returns zero matches flag.
2. UI displays "No exact matches" banner and requests fuzzy suggestions.
3. Worker queries per-column fuzzy index using Damerau-Levenshtein thresholds.
4. Worker returns ranked matches (token, distance, sample row ids) and preview row batches limited to 200 rows.
5. UI shows chips for distance levels and "Back to exact". Selecting fuzzy mode updates filter state to include fuzzy flag persisted per filter.

### 6.4 Tagging and note persistence
1. UI dispatches updateTag or updateNote with row id and payload.
2. Worker updates in-memory annotationMap and marks OPFS document dirty.
3. Session controller batches writes to OPFS annotations.json every 30 seconds or on page unload.
4. On session restore, worker loads annotations before first row window so grid can display tag badges.

### 6.5 Session auto-save and restore
1. Dirty flags set when filters, column layouts, or open file handles change.
2. Every minute session controller serializes session.json (file handle serialized via structuredClone handle reference).
3. On app bootstrap, controller checks OPFS for latest session; if present, requests permission to rehydrate file handle and triggers loadFile with stored filters and layouts.

### 6.6 Export flow
1. User selects export type (filtered CSV or tags JSON).
2. Main thread spawns export worker if dataset exceeds threshold (for example 100,000 rows), otherwise reuses data worker.
3. Worker streams filtered rows to WritableStream targeting FileSystemWritableFileStream provided via showSaveFilePicker.
4. For .csv.gz output, pipeline attaches CompressionStream('gzip').

## 7. Core Algorithms and Data Processing
### 7.1 Streaming parser
- Implements state machine handling delimiters, quotes, and escaped characters to avoid storing entire file.
- Maintains column builders storing string slices initially; large string columns stored as shared backing buffer to minimize copies.
- Parser emits RowBatch objects with typed column arrays and a rowIds vector referencing absolute row numbers.

### 7.2 Type inference
- Samples first N rows per column, applies heuristics (ISO datetime, epoch numbers, numeric, boolean, fallback string).
- Inference metadata stored alongside confidence score; UI displays type chips and allows overrides that trigger reparse or conversion pipeline.

### 7.3 Byte-offset row index
- Every 50,000 rows store byte position and row id in Uint32Array buffer persisted to OPFS row_index.bin.
- Supports random access by seeking nearest checkpoint and streaming forward to target row window.
- Index rebuild persisted after parsing; on re-open, load index before streaming to reduce start-up time.

### 7.4 Filter and sort engine
- Filter expressions represented as abstract syntax tree combining predicates with AND or OR operations.
- Supported predicate operators: equals, not-equals, contains, startsWith, regex, matches, notMatches, numeric ranges, date ranges, boolean.
- Engine processes typed arrays to avoid repeated parsing; uses optimized comparator functions and optional WASM module if profiling justifies.
- String comparisons normalise to lowercase unless predicates explicitly opt into case-sensitive evaluation.
- Sorting leverages TimSort on row id array with comparator referencing typed values; large multi-column sorts can delegate to DuckDB when thresholds hit.

### 7.5 Grouping and aggregations
- For simple groupings (single column with count, sum, min, max, avg) use worker-managed hash map storing aggregates in typed arrays.
- For multi-column or high-cardinality grouping, switch to DuckDB plan: load predicate-matched rows into ephemeral DuckDB table and run SQL query; results streamed back to grid pivot component.

### 7.6 Fuzzy search implementation
- Build per-column dictionary of unique tokens (lowercased, NFC) limited to 50,000 entries or 32 MB memory, whichever comes first.
- Maintain trigram index mapping trigram to token ids stored as compact Uint32Array lists.
- Fuzzy search pipeline:
  1. Candidate generation via trigram overlap.
  2. Score candidates using Damerau-Levenshtein distance with early exit when distance exceeds threshold.
  3. Return top N candidates (default 5) with example rows retrieved by scanning column indexes.
- Cache fuzzy results per filter to support toggling without recomputation.

### 7.7 Tagging and annotations
- Row id stable across operations; tags stored as Record<RowId, { tag: string; note?: string; updatedAt: number }> in worker memory.
- Color palette for tags pre-defined; saved note markdown sanitized with DOMPurify on render (executed on main thread).
- Bulk tag operations supported by sending array of row ids; worker merges updates and returns summary for undo stack.

### 7.8 Undo and redo (nice-to-have)
- UI maintains command stack for tag and note operations and filter changes; undo history is ephemeral and not persisted.

## 8. Data Models and Storage Layout
### 8.1 TypeScript interfaces
```ts
type RowId = number;

interface ColumnMeta {
  key: string;
  type: 'string' | 'number' | 'datetime' | 'boolean';
  inferredFrom: string[];
  allowsNull: boolean;
  width?: number;
}

interface FilterPredicate {
  column: string;
  operator:
    | 'eq'
    | 'neq'
    | 'contains'
    | 'startsWith'
    | 'regex'
    | 'matches'
    | 'notMatches'
    | 'range'
    | 'gt'
    | 'lt'
    | 'between';
  value: unknown;
  value2?: unknown;
  caseSensitive?: boolean;
  fuzzy?: boolean;
}

interface FilterExpression {
  op: 'and' | 'or';
  predicates: (FilterExpression | FilterPredicate)[];
}

interface RowBatch {
  rowIds: Uint32Array;
  columns: Record<string, ArrayBuffer>;
  columnTypes: Record<string, ColumnMeta['type']>;
  stats: { rowsParsed: number; bytesParsed: number; eof: boolean };
}

interface SessionState {
  version: number;
  fileHandle?: FileSystemFileHandle;
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  filters: FilterExpression | null;
  sorts: { column: string; direction: 'asc' | 'desc' }[];
  groups: string[];
  fuzzyOverrides: Record<string, boolean>;
  tagPalette: Record<string, string>;
  lastSavedAt: number;
}

interface AnnotationRecord {
  tag?: string;
  note?: string;
  updatedAt: number;
}
```

### 8.2 OPFS directory structure
```
/opfs
  /sessions
    latest.json            // SessionState
    [timestamp].json       // Older snapshots (max 3 retained)
  /indexes
    row_index.bin          // Uint32Array byte offsets
    schema.json            // ColumnMeta array
    fuzzy_index.json       // Token dictionary metadata (optional)
  /annotations
    tags.json              // Record<RowId, AnnotationRecord>
```
- Files written using atomic replace pattern (write to temp, move).
- Total storage capped (approx 200 MB) with LRU cleanup triggered on session load.

## 9. UI and UX Implementation Details
- Theme system: CSS variables for color tokens; default dark palette aligning with forensic tooling.
- Responsive behavior: Layout optimized for widths 1280 px and above; sidebar collapses for smaller viewports; keyboard shortcuts accessible via command palette.
- Filter builder: Visual tree editor with predicate rows; fuzzy toggle appears when supported by column type.
- Grid context menu: surfaces Filter in/out commands bound to currently focused cell, pre-filling column/value pairs and debouncing duplicate predicates while suppressing the native browser context menu. Regex-capable predicates expose matches / not matches semantics in dropdowns.
- Annotation panel: Slide-over with markdown editor (CodeMirror) and preview.
- Status bar metrics: real-time rows parsed, active filters, memory usage estimate provided by worker.

## 10. Performance and Resource Management
- Target parse throughput >= 80 MB/s using 1 MB chunk size and streaming decoder.
- Maintain memory budget:
  - Row batches limited to 50,000 rows (about 10 MB) and released after rendering.
  - Column dictionaries truncated for very high cardinality; fuzzy search warns when truncated.
- Worker backpressure: UI pauses grid requests if worker signals isBusy to prevent runaway queue.
- Profiling hooks using performance.mark and performance.measure around parse, filter, and fuzzy flows; exposed via developer console.
- Large dataset guardrails: display warning if estimated memory > 600 MB; allow user to adjust batch size or disable fuzzy.

## 11. Error Handling and Resilience
- Wrap OPFS calls in try/catch to surface permission issues with actionable UI prompts.
- Worker errors bubbled via Error objects; UI shows toast with option to download diagnostic JSON (no network upload).
- Auto-save failures trigger retry with exponential backoff and highlight persistent issues.
- Graceful degradation:
  - If Streams API missing, block app (Chromium requirement).
  - If OPFS unavailable, fallback to in-memory session and warn user (reduced functionality).
  - If DuckDB load fails, continue with built-in query engine only.

## 12. Security and Privacy Considerations
- Application runs entirely local; no fetch or XHR except for lazy-loading bundled assets.
- File handles remain in memory; no duplication of file contents beyond transient row buffers.
- Sanitize markdown notes before rendering to prevent script execution.
- Respect File System Access permission lifecycle; revoke handles on session clear.
- Avoid storing sensitive data in localStorage beyond non-identifying preferences.

## 13. Testing Strategy
- Unit tests (Vitest): parser state machine, type inference, filter operations, fuzzy distance boundaries, annotation reducers.
- Worker integration tests: run worker in web worker test harness to validate streaming parse, filter combinations, persistence serialization.
- UI component tests: React Testing Library for filter builder, tag editor, fuzzy banner logic.
- End-to-end tests (Playwright Chromium): cover file load (using synthetic CSV via File API), filter interactions, tagging, session restore, export flows.
- Performance harness: headless script generating 2 GB synthetic dataset to benchmark parse time, filter latency, memory consumption (run manually on Chromium).
- Accessibility audits: axe-core integration ensuring keyboard navigation and contrast compliance.

## 14. Tooling and Build Pipeline
- Vite build with separate entry points for main app and workers; Rollup chunk splitting keeps worker payload below 1 MB compressed.
- ESLint and Prettier for code quality; optional Husky pre-commit hooks to run lint and test tasks.
- Use pnpm for dependency management and reproducible lockfile.
- Static hosting deployment (GitHub Pages, S3, or packaged offline build) since app is self-contained.
- BD workflow integration: commit .beads/issues.jsonl alongside code changes to align with project tracking rules.

## 15. Deployment and Distribution
- Delivered as static assets; documentation instructs analysts to download release bundle and open index.html in Chromium or use static server.
- Include PWA manifest for optional install (works offline, but no Service Worker caching of data files to honor "no duplication" principle).
- Version gating: embed build info and compatibility check.

## 16. Open Issues and Follow-ups
- Determine optimal row index granularity (10,000 vs 50,000) once benchmarks available, tying back to PRD open question.
- Decide default execution path for complex filters: evaluate DuckDB versus native engine once dataset characteristics are known.
- Finalize annotation UX (inline versus side panel) after user testing; current plan implements side panel with quick-edit tooltip.
- Clarify whether filtered view should limit note JSON export (pending product decision; current design exports all annotations with filter metadata flag).
- Evaluate need for additional worker dedicated to fuzzy search if profiling reveals contention.
