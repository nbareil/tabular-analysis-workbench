# Tabular Analysis Workbench

The Tabular Analysis Workbench is a Chromium-only, browser-native environment for
forensic timelines and other long CSV/TSV datasets. It streams multi-gigabyte
files directly from the local file system, evaluates complex filters inside a
dedicated worker, and lets analysts tag, annotate, and export insights without
ever uploading data off the device.

https://nbareil.github.io/tabular-analysis-workbench/


## Why This Tool Exists
- 100% local analysis: zero ingestion services, no telemetry, and no data leaves
  the user’s machine.
- Built for very large CSV/TSV and `.gz` variants with back-pressure-aware
  streaming and incremental rendering.
- Feels like a spreadsheet tuned for DFIR workflows: global search, grouping,
  annotations, and persistence designed around long-form timelines.

## Feature Overview

| Capability | Description |
| --- | --- |
| Streaming ingestion | Streams files up to ~2 GB with gzip support, chunked workers, and checkpointed byte offsets for random access. |
| Filtering & search | Rich filter builder, regex operators, per-cell context menu shortcuts, and a fuzzy fallback path. |
| Grouping & aggregations | Worker-powered pivoting plus DuckDB-WASM fallback for high-cardinality workloads. |
| Tagging & notes | Color-coded tags, markdown notes, and import/export flows persisted to the Origin Private File System (OPFS). |
| Session persistence | Auto-saves filters, layouts, and annotation state to OPFS so sessions resume instantly. |
| UI polish | Column chooser, collapsible filter panel, keyboard shortcuts, accessibility fixes, and global search. |

### Detailed Capabilities
- **File support:** `.csv`, `.tsv`, `.csv.gz`, `.tsv.gz` with delimiter detection.
  Files never leave the device thanks to the File System Access API.
- **Multi-threaded parsing:** Type inference, ingestion batching, and byte-offset
  indexing run in a dedicated worker, keeping the UI responsive as data streams
  in.
- **Filters and grouping:** Combine equals/contains/range/regex predicates,
  toggle case sensitivity, and pivot over one or more columns with counts,
  min/max, sum, and average.
- **Fuzzy fallback search:** Damerau–Levenshtein powered search activates when
  exact filters return zero rows, with distance chips and “back to exact”
  controls.
- **Tagging & annotation workflow:** Apply labels, open the Tag/Note dialog, and
  synchronize markdown notes; exports honor OPFS storage limits and deliver JSON
  bundles ready for sharing.
- **Session restore:** Auto-saves every minute, reloads the previous dataset,
  filters, column sizing, and annotation state after the user grants the file
  handle again.
- **Security posture:** All work stays local, markdown rendering is sanitized,
  and capability checks enforce Chromium-only APIs.

## Architecture Snapshot
- **React 18 + Vite** UI with Tailwind theming and AG Grid virtualization.
- **Workers everywhere:** Comlink-powered data worker handles parsing, query
  execution, fuzzy search, and DuckDB plans so the UI just receives row batches.
- **Origin Private File System (OPFS):** Persists session metadata, annotation
  maps, and byte-offset checkpoints for fast resume.
- **DuckDB-WASM optional path:** Provides SQL-like aggregations for heavy
  grouping and sorting workflows.
- **Testing stack:** Vitest + Testing Library for unit/component coverage with
  Playwright-based end-to-end tests on the roadmap.

## Installation

### Prerequisites
- Node.js 20+ and npm (or use the provided Nix flake: `nix develop`).
- A Chromium-based browser (Chrome, Edge, Brave) ≥ 119 with File System Access,
  Streams API, and OPFS support.
- (Optional) `bd` CLI if you plan to interact with the beads issue tracker.

### Steps
1. Clone the repository.
2. Install dependencies: `npm install`.
3. Start the development server: `npm run dev`.
4. Open `http://localhost:5173` in Chromium; grant file-system permissions when
   prompted.

To build the production bundle:

```
npm run build
npm run preview   # Serves dist/ for local smoke tests
```

## Usage Guide

### Loading Data
1. Launch the app and choose **Open file**.
2. Select a CSV/TSV (optionally gzipped). The ingestion log in the status bar
   shows streaming progress as batches arrive.
3. The grid renders as soon as the first batch finishes parsing so you can start
   triaging before ingestion completes.

### Filtering & Search
- Use the **Filter Builder** to add predicates per column. Context menus (right
  click) provide “Filter in/out” shortcuts.
- Toggle case sensitivity, match mode (equals/contains/regex), or default time
  ranges for datetime fields.
- Run a **Global Search** across visible columns; when no rows match, enable the
  suggested fuzzy distance chips to widen the results.

### Grouping & Aggregations
- Open the **Pivot** panel to drag columns into rows/values, or trigger worker
  aggregations from the column sidebar. Counts, sum, min, max, and averages are
  streamed back to the grid.

### Tagging & Notes
- Select rows and press `T` to open the Tag/Note dialog. Tags carry color
  palettes and optional markdown notes.
- Use the Labels panel in the left sidebar to batch-apply or remove tags and to
  import/export the annotation JSON bundle.

### Session Persistence & OPFS
- Sessions auto-save every minute and whenever you close the file picker. On
  reload you will be prompted to re-authorize the last dataset so filters, tags,
  and layout return instantly.

### Exporting Results
- Use **Export → Filtered rows** to write the visible dataset to `.csv` or
  `.csv.gz` without mutating the source file.
- Use **Export → Tags/Notes** to capture annotations for sharing or archival.

### Keyboard & Accessibility
- Common shortcuts: `Ctrl/Cmd+K` for global search, `T` for tagging, arrow keys
  for navigation, `/` to focus filter search.
- The filter sidebar can be collapsed to maximize the grid.

## Development Commands
- `npm run lint` – ESLint across `ts`/`tsx` files.
- `npm run test` – Vitest unit and worker suites.
- `npm run dev` – Vite dev server with hot reload.
- `npm run build` – Type check + optimized production build.

## Roadmap & Open Work
Future enhancements, bugs, and test coverage tasks live in the beads backlog.
Check `.beads/issues.jsonl` or run `bd ready --json` to see current ready work
before picking up a task.

## Support & Contributions
- File new feature or bug ideas through `bd create` so they enter the shared
  beads backlog.
- Keep documentation, requirements, and implementation notes in sync when you
  contribute new features.
