# Tabular Analysis Workbench

The Tabular Analysis Workbench is a Chromium-only, browser-native environment for
forensic timelines and other long CSV/TSV datasets. It streams multi-gigabyte
files directly from the local file system, evaluates complex filters inside a
dedicated worker, and lets analysts tag, annotate, and export insights without
ever uploading data off the device.

## Why This Tool Exists
- 100% local analysis — no ingestion services, no telemetry (PRD §1, §3).
- Optimized for very large CSV/TSV and `.gz` variants with back-pressure aware
  streaming (`csv-explorer-62f1`, `csv-explorer-67e7`).
- Provides spreadsheet-like ergonomics (global search, grouping, annotations) on
  top of forensic-first defaults defined in PRD/TDD.

## Feature Overview

| Capability | Description | Tracking |
| --- | --- | --- |
| Streaming ingestion | Streams up to 2 GB with gzip support, worker batching, and checkpointed byte offsets (`csv-explorer-62f1`, `csv-explorer-67e7`, `csv-explorer-b8ac`). |
| Filtering & search | Rich filter builder with regex operators, per-cell context menu, and fuzzy fallback (`csv-explorer-0ed3`, `csv-explorer-5a19`, `csv-explorer-5bae`, PRD §3.3.a). |
| Grouping & aggregations | Worker-powered pivoting plus DuckDB-WASM fallback (`csv-explorer-6dd0`, `csv-explorer-5272`, `csv-explorer-6a6a`). |
| Tagging & notes | Color-coded tags, markdown notes, and import/export flows persisted to OPFS (`csv-explorer-246f`, `csv-explorer-8ad2`, `csv-explorer-4397`). |
| Session persistence | Auto-save filters, layouts, and annotation state to OPFS (`csv-explorer-ef29`, `csv-explorer-504f`). |
| UI polish | Column chooser, collapsible filter panel, keyboard shortcuts, and accessibility fixes (`csv-explorer-190c`, `csv-explorer-d7be`, `csv-explorer-pw0`). |

### Detailed Capabilities
- **File support:** `.csv`, `.tsv`, `.csv.gz`, `.tsv.gz` with delimiter detection and
  UTF-8 decoding. Files are opened through the File System Access API and never
  re-uploaded (PRD §4.1, TDD §7.1).
- **Multi-threaded parsing:** Type inference, ingestion batching, and byte-offset
  indexing live in a dedicated worker so the UI stays responsive
  (`csv-explorer-0d22`, `csv-explorer-0982`).
- **Filters and grouping:** Combine equals/contains/range/regex predicates,
  toggle case sensitivity (`csv-explorer-bd6e`), and pivot over one or more
  columns with counts, min/max, sum, and avg (PRD §4.3, TDD §7.4–7.5).
- **Fuzzy fallback search:** Damerau–Levenshtein powered search when exact
  filters return zero rows, including distance chips and “back to exact” controls
  (`csv-explorer-9119`, PRD §3.3.a).
- **Tagging & annotation workflow:** Apply labels, launch the Tag/Note dialog,
  and synchronize markdown notes; exports honor OPFS storage limits and deliver
  JSON bundles ready for sharing (`csv-explorer-246f`, `csv-explorer-b60e`).
- **Session restore:** Auto-saves every minute, reloads the previous dataset,
  filters, column sizing, and annotation state after you grant the file handle
  again (TDD §6.5, issues `csv-explorer-ef29`, `csv-explorer-807a`).
- **Security posture:** All work stays local, markdown rendering is sanitized
  (`csv-explorer-91da`), and capability checks enforce Chromium-only APIs
  (`csv-explorer-7e92`).

## Architecture Snapshot
- **React 18 + Vite** UI with Tailwind theming and AG Grid virtualization (TDD
  §3.1–3.2).
- **Workers everywhere:** Comlink-powered data worker handles parsing, query
  execution, fuzzy search, and DuckDB plans so the UI just receives row batches.
- **Origin Private File System (OPFS):** Persists session metadata, annotation
  maps, and byte-offset checkpoints for fast resume (PRD §4.6, TDD §7.3, §7.6).
- **DuckDB-WASM optional path:** For high-cardinality grouping and SQL-like
  aggregations (`csv-explorer-6a6a`).
- **Testing stack:** Vitest + Testing Library for unit and component tests, with
  planned Playwright-based end-to-end coverage (`csv-explorer-823d`).

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
   shows streaming progress (`csv-explorer-58fc`).
3. The grid begins rendering as soon as the first batch arrives (issue
   `csv-explorer-86c3`).

### Filtering & Search
- Use the **Filter Builder** to add predicates per column. Context menus (right
  click) provide “Filter in/out” shortcuts (`csv-explorer-5a19`).
- Toggle case sensitivity, match mode (equals/contains/regex), or time range
  defaults defined in PRD §4.3.
- Run a **Global Search** across visible columns; if nothing matches, enable the
  suggested fuzzy distance chips to widen the results (`csv-explorer-776c`,
  `csv-explorer-5bae`).

### Grouping & Aggregations
- Open the **Pivot** panel to drag columns into rows/values, or trigger worker
  aggregations from the column sidebar. Counts, sum, min, max, and averages are
  streamed back to the grid (`csv-explorer-6dd0`, `csv-explorer-5272`).

### Tagging & Notes
- Select rows and press `T` to open the Tag/Note dialog. Tags carry color
  palettes and optional markdown notes (`csv-explorer-246f`).
- Use the Labels panel in the left sidebar to batch-apply or remove tags and to
  import/export the annotation JSON bundle (`csv-explorer-4397`,
  `csv-explorer-f77b`).

### Session Persistence & OPFS
- Sessions auto-save every minute and whenever you close the file picker; on
  reload you will be prompted to re-authorize the last dataset so filters, tags,
  and layout return instantly (`csv-explorer-ef29`, `csv-explorer-807a`).

### Exporting Results
- Use **Export → Filtered rows** to write the visible dataset to `.csv` or
  `.csv.gz` without mutating the source file (`csv-explorer-ba99`).
- Use **Export → Tags/Notes** to capture annotations for sharing or archival
  (`csv-explorer-b60e`).

### Keyboard & Accessibility
- Common shortcuts: `Ctrl/Cmd+K` for global search, `T` for tagging, arrow keys
  for navigation, `/` to focus filter search (`csv-explorer-dik`,
  `csv-explorer-pw0`).
- The filter sidebar can be collapsed to maximize the grid
  (`csv-explorer-d7be`).

## Development Commands
- `npm run lint` – ESLint across `ts`/`tsx` files.
- `npm run test` – Vitest unit and worker suites (`csv-explorer-3919`).
- `npm run dev` – Vite dev server with hot reload.
- `npm run build` – Type check + optimized production build.

## Roadmap & Open Issues
Active planning is tracked in beads; notable open work includes:
- `csv-explorer-048b` – Investigate file ingestion success report with empty
  grid.
- `csv-explorer-0899` – Harden error handling tests for malformed CSV and OPFS
  failures.
- `csv-explorer-1150` – Finalize behavior for annotation export scope.
- `csv-explorer-26e3` – Surface richer status bar metrics.
- `csv-explorer-807a` – Auto-save scheduler and storage limit UX.
- See `.beads/issues.jsonl` or run `bd ready --json` for the full queue.

## Support & Contributions
- File new feature or bug ideas through `bd create` so they enter the shared
  beads backlog.
- Align work ideas with PRD/TDD references to maintain requirement traceability.
