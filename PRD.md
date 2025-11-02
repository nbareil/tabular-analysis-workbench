# Tabular Analysis Workbench (CSV/TSV) — Product Requirements Document (PRD)

**Version:** 1.2  
**Author:** [Your Name]  
**Date:** YYYY-MM-DD  
**Status:** Draft / Confirmed Requirements

---

## 1. Overview

**Goal**  
Develop a high-performance, browser-native CSV/TSV exploration tool for forensic and analytical use.  
The application runs **entirely in the analyst’s web browser** (Chromium only), supports **very large CSV/TSV files (up to 2 GB)** via streaming, and provides **filtering, grouping, tagging, and annotation** similar to Eric Zimmerman’s *Timeline Explorer* — but with a **modern, minimalist design** and advanced session persistence.

**Core Principle**  
- No installation  
- No network calls  
- No data duplication  
- 100 % local analysis  

---

## 2. Target Audience

- DFIR analysts  
- Threat hunters / Detection engineers  
- Security researchers working with timeline exports (KAPE, Plaso, etc.)  
- Analysts dealing with long structured datasets  

The tool behaves like a *forensic spreadsheet on steroids* — optimized for filtering, grouping, and annotation of large CSV timelines.

---

## 3. Product Objectives

| # | Objective | Description | Priority |
|:-:|------------|--------------|-----------|
| 1 | **Stream large CSV/TSV files** | Efficiently parse and browse up to 2 GB via Streams API + Web Workers. | 🟩 Must |
| 2 | **Chromium-only** | Target latest Chromium with experimental APIs (OPFS, DecompressionStream). | 🟩 Must |
| 3 | **Local-only** | Zero network traffic; runs offline; no telemetry. | 🟩 Must |
| 4 | **Modern minimalist UI** | Clean, dark-first interface. | 🟩 Must |
| 5 | **Filtering, sorting, grouping** | Powerful per-column filters, pivot-style grouping. | 🟩 Must |
| 6 | **Tagging & annotation** | Row tagging and markdown notes; exportable JSON. | 🟩 Must |
| 7 | **Persistent sessions** | Save/restore layout, filters, notes across restarts via OPFS. | 🟩 Must |
| 8 | **Fuzzy fallback search** | Automatic typo-tolerant search when no match found. | 🟩 Must |
| 9 | **Data integrity** | Read-only access; user keeps file ownership. | 🟩 Must |

---

## 4. Functional Requirements

### 4.1 File Support
- Accept **`.csv`**, **`.tsv`**, **`.csv.gz`**, **`.tsv.gz`**
- File selection via **native file picker**.
- Auto-detect delimiter, header, and encoding (UTF-8 default).
- Stream parse using `File.stream()` + `DecompressionStream('gzip')`.
- Never copy data; operate on file handle only.

### 4.2 Parsing & Data Model
- Parser runs in **Web Worker**:
  - Streaming `TextDecoder`
  - Batch emission (e.g., 50 000 rows)
  - Byte-offset index every N rows for random paging
- Designed for **long, narrow** datasets.
- Optional **DuckDB-WASM** backend for SQL-style filtering/grouping.
- Type inference (string, number, datetime, boolean).

### 4.3 Data Operations
- **Sorting**: multi-column.  
- **Filtering**:  
  - “TLE-style” textual predicates (equals, contains, begins, regex, range).  
  - Advanced regex operators: **matches** / **not matches** leverage browser RegExp evaluation for include/exclude patterns.
  - Case-insensitive by default with per-filter **Case sensitive** toggle for forensic precision.
  - Boolean AND/OR logic per column.  
  - Grid-level context actions: right-click on any cell provides **Filter in** / **Filter out** shortcuts that append the cell value as an equality or inequality predicate.
- **Grouping / Pivoting**:  
  - Group by one + columns.  
  - Aggregations: count, sum, min, max, avg.  
- **Global Search** across all visible columns.  
  - Default case-insensitive matching with optional **Case sensitive** toggle beside the search bar.
- **Fuzzy Fallback Search** if no exact match (see § 3.3.a).

### 4.4 Tagging & Annotation
- Per-row fields:
  - `tag` (string or color label)
  - `note` (markdown text)
- Stored separately in OPFS as `{row_id:{tag,note}}`.
- Export/import as JSON for sharing.

### 4.5 Grid & Visualization
- Virtualized grid (AG Grid or equivalent):  
  - Infinite scroll, pinned columns, resize.  
  - Multi-select + copy as CSV.  
  - Conditional coloring (e.g., by tag).  
  - Context menu integrates filter affordances (Filter in / Filter out) honoring active session filters.
- Column sidebar (visibility, type, aggregates).
- Column chooser accessible from top bar lists all columns with visibility toggles.
- Keyboard shortcuts: open, filter, export, theme toggle.

- Filter sidebar can be collapsed to maximize grid width (toggle in header).
### 4.6 Session Management
- Persist to OPFS:
  - File handle
  - Schema & column order
  - Filters / groups / sorts
  - Tags & notes
  - UI preferences
- Auto-save every minute; restore on reload.

### 4.7 Export
- Export:
  - Filtered/grouped subset → `.csv` or `.csv.gz`
  - Tags / notes → `.json`
- Never modify original file.

---

## 3.3.a Fuzzy Search & Filtering (No-Match Fallback)

**Goal:** Provide typo-tolerant search when an exact filter yields 0 results.

### UX Behavior
- If no exact matches:
  - Display banner: “No exact matches for ‘login.sucess’. Showing fuzzy matches (≤ 2 edits).”
  - Show chips for distance (≤1/≤2/≤3) and “Back to exact”.
  - Present “Did you mean…” (top 5 tokens) from column dictionary.
- Persist fuzzy state per filter; toggle via UI or `Alt + ~`.

### Matching Logic
- **Metric:** Damerau–Levenshtein distance.  
- **Normalization:** case-insensitive, trimmed, NFC.  
- **Threshold:** ≤ 2 for len ≥ 5; ≤ 1 for len 3–4.  
- **Tokenized:** per-token compare; match if any token within threshold.

### Ranking
1. Lower distance  
2. Shorter field length  
3. Original row order  

### Performance
- Fuzzy path ≤ 1.5× exact latency for first page.  
- Limit to top K (≈ 5000) matches; UI indicates sample size.

### Architecture
1. **Candidate Pruning** via 3-gram index.  
2. **Distance Check** (Damerau–Levenshtein WASM/JS SIMD).  
3. Lazy build per column; cache to OPFS:  
   `/idx/{fileId}/{col}/grams-3.bin` + `dict.json`.

### Config Defaults
fuzzy.enabled = true
fuzzy.maxDistance = 2
fuzzy.maxResults = 5000
fuzzy.ngramSize = 3

yaml
Copier le code

---

## 5. Non-Functional Requirements

| Category | Requirement |
|-----------|--------------|
| **Performance** | Open 2 GB CSV ≤ 30 s on 16 GB RAM laptop. |
| **Responsiveness** | Filter 1 M rows < 1 s. |
| **Memory** | ≤ 600 MB steady-state. |
| **Security** | Read-only file handle; no network. |
| **Portability** | Chromium only. |
| **Reliability** | Graceful fallback for unsupported APIs. |
| **Maintainability** | Modular parser / worker / UI / storage. |
| **Accessibility** | Keyboard navigable; dark/light themes. |

---

## 6. Technical Architecture

┌────────────────────────────┐
│ UI Layer │
│ Modern grid + filters + tags│
│ Minimal React/Vanilla view │
└──────────────┬─────────────┘
│
MessageChannel (postMessage)
│
┌──────────────▼─────────────┐
│ Worker Engine │
│ - Stream parser (CSV/TSV) │
│ - Row indexer (byte offsets)│
│ - Filter/Sort/Fuzzy engine │
│ - DuckDB-WASM (optional) │
│ - Tag/Note manager │
└──────────────┬─────────────┘
│
Origin Private File System
(index cache, session, annotations)

yaml
Copier le code

---

## 7. UI / UX Design

### Design Language
Minimalist, dark-first, functional.  
Typography: Inter + JetBrains Mono.

### Layout

| Area | Function |
|------|-----------|
| **Top Bar** | File picker • Global search • Export • Theme toggle • Options menu |
| **Left Sidebar** | Columns • Types • Aggregates |
| **Main Grid** | Virtualized data view + tags |
| **Bottom Bar** | Row count • File name • Performance stats |

### Keyboard Shortcuts

| Action | Shortcut |
|--------|-----------|
| Open file | ⌘/Ctrl + O |
| Search | ⌘/Ctrl + F |
| Export | ⌘/Ctrl + E |
| Toggle dark mode | ⌘/Ctrl + D |
| Toggle tags panel | ⌘/Ctrl + T |
| Toggle fuzzy | Alt + ~ |

---

## 8. Persistence Model

| Item | Storage | Lifetime |
|------|----------|-----------|
| Session metadata | OPFS (JSON) | Persistent |
| Row index | OPFS (binary) | Persistent |
| Fuzzy index | OPFS (binary) | Persistent |
| Tags / notes | OPFS (JSON) | Persistent |
| Settings / theme | localStorage | Persistent |
| Parsed rows | Memory (paged) | Ephemeral |

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|---------|------------|
| Browser memory limits | High | Stream + virtualize + paging |
| OPFS API changes | Medium | Versioned adapter layer |
| Gzip performance | Medium | Adjustable chunk size |
| Large columns in fuzzy search | Medium | Skip fuzzy > 512 chars |
| User data loss | Low | Auto-save sessions regularly |

---

## 10. Milestones

| Phase | Deliverables | ETA |
|-------|---------------|-----|
| **M1 — Parser Prototype** | Stream parser + virtual grid | 3 weeks |
| **M2 — Filtering & Sorting** | Worker predicates + UI | 2 weeks |
| **M3 — Grouping & DuckDB** | Pivot / aggregations | 3 weeks |
| **M4 — Tagging & Notes** | UI + JSON export | 2 weeks |
| **M5 — Fuzzy Search** | N-gram index + DL distance | 3 weeks |
| **M6 — Persistence & Polish** | OPFS sessions + UX | 2 weeks |

---

## 11. Success Criteria

- 2 GB CSV opens ≤ 30 s.  
- Filter 1 M rows < 1 s.  
- Memory ≤ 600 MB.  
- Sessions persist after restart.  
- Tags / notes export/import OK.  
- Fuzzy fallback returns accurate suggestions.  
- UI rated “simple and fast” by analysts.

---

## 12. Future Enhancements

- Column profiling / histograms  
- Multi-file joins by timestamp  
- Remote HTTP Range loading  
- WASM bzip2/xz decompression  
- Plugin SDK for custom renderers  

---

## 13. Open Questions

| Topic | Question |
|--------|-----------|
| Row index granularity | Ideal interval (10k vs 50k)? |
| Filter execution | Use DuckDB for simple filters or native JS? |
| Annotation UX | Inline cell vs side panel editor? |
| Export | Should filters affect note JSON export? |

---
### Options Panel
- Header button opens modal tab for session-scoped preferences.
- Typography controls: separate interface and data-grid font selectors plus size inputs, both defaulting to 14 px, with live preview.
- Future affordances may include density, number formatting, and timezone handling.
