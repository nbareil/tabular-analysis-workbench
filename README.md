# Tabular Analysis Workbench

The Tabular Analysis Workbench is a Chromium-only, browser-native environment for
forensic timelines and other long CSV, TSV and JSON Lines datasets. It streams multi-gigabyte
files directly from the local file system, evaluates complex filters inside a
dedicated worker, and lets analysts tag, annotate, and export insights without
ever uploading data off the device.

https://nbareil.github.io/tabular-analysis-workbench/


## Why This Tool Exists
- 100% local analysis: zero ingestion services, no telemetry, and no data leaves
  the user’s machine.
- Built for very large CSV, TSV and JSON Lines files, compressed or not, with
  back-pressure-aware streaming and incremental rendering.
- Feels like a spreadsheet tuned for DFIR workflows: global search, timelines,
  grouping, labels and notes.
- Never alters your data: every cell keeps its original text; type inference only
  changes how filters, sorts and aggregates read a column.

## Feature Overview

| Capability | Description |
| --- | --- |
| Streaming ingestion | Streams multi-GB CSV, TSV or JSON Lines files (format and gzip detected from the content) into an OPFS row cache; the grid shows rows while the file is still loading. |
| Super-timelines | Open several files at once, in any mix of formats, to merge them into one dataset with a `source_file` column. |
| Filtering & search | Filter builder (equals, contains, starts with, regex, ranges), cell context menu shortcuts, time-window filters, highlighted global search, and exact-value suggestions when an equality filter matches nothing. |
| Timelines & profiling | Timeline histogram per datetime column (click or drag to filter) and column profiles (empties, distinct values, min/max, top values). |
| Grouping & aggregations | Worker-powered pivot over the current view with count, sum, min, max and average. |
| Labels & notes | Any number of colour labels per row (MITRE ATT&CK tactics by default), markdown notes, undo/redo, JSON import/export, and saving to the Origin Private File System (OPFS). |
| Time zones | Show timestamps as written in the file, or converted to UTC or any time zone. Timestamps without a zone are treated as UTC. |
| Export | Current view or labelled rows only, as `.csv` or `.csv.gz`, with spreadsheet formula injection neutralised. |

### Detailed Capabilities
- **File support:** delimited text (`.csv`, `.tsv`, `.txt`) and JSON Lines
  (`.jsonl`, `.ndjson`, or `.json` and `.log` files with one object per line),
  plain or gzip-compressed. The content decides the format, not the file name: a
  file whose first non-blank character is `{` is JSON Lines. For delimited text, the
  delimiter (tab, comma, semicolon or pipe) is detected from the header line.
  Files never leave the device thanks to the File System Access API.
- **JSON Lines:** each line holding a JSON object becomes a row, and nested
  objects become dotted columns such as `process.parent.pid`. Columns that share
  a parent stay next to each other, however late their keys first appear. Arrays
  keep their JSON text, numbers keep every digit as written (`12345678901234567890`
  is not rounded), strings are unescaped, `null` is an empty cell, and a repeated
  key keeps its last value.
- **Imperfect JSON Lines:** a line that is not a JSON object, such as a truncated
  last line, stays in the dataset as a row with its text in the `malformed_line`
  column, and is counted in the status bar. A file creates at most 1,000 columns
  from its keys; values of later keys go into an `other_fields` column as a JSON
  object, and objects nested more than 20 levels deep keep their JSON text. A
  JSON document (an array, or one object spread over several lines) is rejected
  with a hint to convert it.
- **Robust delimited parsing:** quoted fields with embedded delimiters, quotes and newlines;
  stray quotes inside unquoted fields (`12" disk`) stay literal; blank lines are
  skipped; rows with too many or too few fields are kept and counted in the
  status bar; duplicate header names are renamed.
- **Strict types:** numbers, booleans and ISO-like timestamps (plus epoch
  seconds/milliseconds between 2000 and 2100) are recognised. Text such as
  `Event 4624` is never mistaken for a date, and `007` stays `007` on screen.
- **Exact-value suggestions:** when an equality filter returns zero rows, the
  worker suggests nearby exact values without changing the result set.
- **Labels & notes:** labels and notes are saved per file within a second of an
  edit, and kept for 21 days after the file was last opened. Imports from a file
  with a different row count are rejected so labels never land on the wrong rows.
- **Security posture:** all work stays local, markdown is sanitised, CSV exports
  neutralise formulas, and capability checks enforce Chromium-only APIs.

## Architecture Snapshot
- **React 18 + Vite** UI with Tailwind theming and AG Grid virtualization.
- **One data worker** (Comlink) parses files, stores raw cell text in OPFS, and
  runs filter → search → sort as a serial pipeline in which newer requests cancel
  older ones.
- **Origin Private File System (OPFS):** holds the row cache for the open dataset
  and the per-file annotation snapshots.
- **Testing stack:** Vitest + Testing Library for unit, worker integration and
  component tests; Playwright + axe-core for end-to-end and accessibility tests
  in Chromium. See `TDD.md` for the design.

## Installation

### Prerequisites
- Node.js 22+ and npm (or use the provided Nix flake: `nix develop`).
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
1. Choose **Open Files** and pick one file, or several to merge them into a
   single timeline. CSV, TSV and JSON Lines files can be mixed.
2. The status bar shows streaming progress. The grid renders as soon as the
   first batch is parsed, so you can start triaging before ingestion completes.

### Filtering & Search
- Use the **Filter Builder** (`f` toggles it, `a` adds a filter) to add
  predicates per column, each with an optional **Case sensitive** toggle.
- Right-click a cell for **Filter in / Filter out**, or, on a timestamp,
  **Filter time window around this value**.
- Right-click a column header for value counts with checkbox filters, a
  **column profile**, and, for datetime columns, a **timeline** histogram.
- **Global search** (`/` or `Ctrl/Cmd+K`) scans visible columns and highlights
  matches; Enter / Shift+Enter jump to the next / previous match.
- Undo and redo filter or label changes with `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`.

### Grouping & Aggregations
- Open **Pivot View**, choose group-by columns and aggregations (count, sum,
  min, max, average). Results cover the current filtered/searched rows.

### Labels & Notes
- Select rows, then right-click the **Labels** column to apply or remove labels.
  With the grid focused, `T` edits the focused row's labels and note, and
  `[` / `]` jump to the previous / next labelled row.
- Use the **Labels** panel to manage labels and to import annotation bundles.

### Navigation
- `g` focuses **Go to row**, which jumps to a row by its number in the file.
- Arrow keys move through rows, Shift+Arrow extends the selection and Space
  toggles it.

### Persistence & Storage
- Labels and notes are saved automatically per file. Filters, sorts and layout
  apply to the current visit only.
- Preferences (theme, fonts, case sensitivity, display time zone) are kept in
  the browser.
- **Options → Delete stored data** removes cached rows, annotations and
  preferences from this browser.

### Exporting Results
- **Export → Rows in current view** writes the filtered, searched and sorted
  rows to `.csv` or `.csv.gz` without touching the source file.
- **Export → All labelled rows** adds `labels` and `note` columns.
- **Export → All labels & notes** saves the annotation bundle as JSON.
- Both annotation exports always contain every labelled or annotated row and ignore filters and
  search; use **Rows in current view** for a filtered subset.

## Development Commands
- `npm run lint` – ESLint across `ts`/`tsx` files.
- `npm run test` – Vitest unit and worker suites.
- `npm run e2e` – Playwright end-to-end and axe accessibility tests in Chromium
  (starts its own dev server on port 4174; run `npx playwright install chromium` once).
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
