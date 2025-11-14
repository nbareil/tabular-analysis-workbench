# Tabular Analysis Workbench

The Tabular Analysis Workbench is a Chromium-only, browser-native environment for
forensic timelines and other long CSV/TSV datasets. It streams multi-gigabyte
files directly from the local file system, evaluates complex filters inside a
dedicated worker, and lets analysts tag, annotate, and export insights without
ever uploading data off the device.

## Why This Tool Exists
- 100% local analysis — no ingestion services, no telemetry (PRD §1, §3).
- Optimized for very large CSV/TSV and `.gz` variants with back-pressure aware
  streaming (PRD §4.1, TDD §7.1–7.3).
- Provides spreadsheet-like ergonomics (global search, grouping, annotations)
  on top of forensic-first defaults defined in the PRD/TDD set.

## Feature Overview

| Capability | Description | Specs |
| --- | --- | --- |
| Streaming ingestion | Streams up to 2 GB with gzip support, worker batching, and checkpointed byte offsets. | PRD §4.1, TDD §7.1–7.3 |
| Filtering & search | Rich filter builder with regex operators, per-cell context menu, and fuzzy fallback. | PRD §4.3, §3.3.a; TDD §7.4 |
| Grouping & aggregations | Worker-powered pivoting plus DuckDB-WASM fallback for heavy workloads. | PRD §4.3; TDD §7.5 |
| Tagging & notes | Color-coded tags, markdown notes, and import/export flows persisted to OPFS. | PRD §4.4; TDD §7.7 |
| Session persistence | Auto-save filters, layouts, and annotation state to OPFS. | PRD §4.6; TDD §6.5, §7.6 |
| UI polish | Column chooser, collapsible filter panel, keyboard shortcuts, and accessibility fixes. | PRD §4.5, §4.3 |

### Detailed Capabilities
- **File support:** `.csv`, `.tsv`, `.csv.gz`, `.tsv.gz` with delimiter detection and
  UTF-8 decoding. Files use the File System Access API and never leave the
  device (PRD §4.1, TDD §7.1).
- **Multi-threaded parsing:** Type inference, ingestion batching, and byte-offset
  indexing live in a dedicated worker so the UI stays responsive (TDD §3.2,
  §7.2–7.3).
- **Filters and grouping:** Combine equals/contains/range/regex predicates,
  toggle case sensitivity, and pivot over one or more columns with counts,
  min/max, sum, and average (PRD §4.3, TDD §7.4–7.5).
- **Fuzzy fallback search:** Damerau–Levenshtein powered search when exact
  filters return zero rows, complete with distance chips and “back to exact”
  controls (PRD §3.3.a, TDD §7.6).
- **Tagging & annotation workflow:** Apply labels, open the Tag/Note dialog, and
  synchronize markdown notes; exports honor OPFS storage limits and deliver JSON
  bundles ready for sharing (PRD §4.4, TDD §7.7).
- **Session restore:** Auto-saves every minute, reloads the previous dataset,
  filters, column sizing, and annotation state after you grant the file handle
  again (TDD §6.5, §7.6).
- **Security posture:** All work stays local, markdown rendering is sanitized,
  and capability checks enforce Chromium-only APIs (PRD §5, TDD §3.1).

## Architecture Snapshot
- **React 18 + Vite** UI with Tailwind theming and AG Grid virtualization (TDD
  §3.1–3.2).
- **Workers everywhere:** Comlink-powered data worker handles parsing, query
  execution, fuzzy search, and DuckDB plans so the UI just receives row batches.
- **Origin Private File System (OPFS):** Persists session metadata, annotation
  maps, and byte-offset checkpoints for fast resume (PRD §4.6, TDD §7.3, §7.6).
- **DuckDB-WASM optional path:** For high-cardinality grouping and SQL-like
  aggregations (TDD §7.5).
- **Testing stack:** Vitest + Testing Library for unit and component tests, with
  planned Playwright-based end-to-end coverage (TDD §9).

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
- Toggle case sensitivity, match mode (equals/contains/regex), or time range
  defaults defined in PRD §4.3.
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
- Align work ideas with PRD/TDD references to maintain requirement traceability.
