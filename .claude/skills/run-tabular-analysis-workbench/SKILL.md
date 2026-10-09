---
name: run-tabular-analysis-workbench
description: Run, start, launch, drive, smoke-test or screenshot the Tabular Analysis Workbench web app (Vite + React CSV/timeline viewer) in headless Chromium - load a CSV, sort, search, filter, label, undo, timeline, profile, export.
---

# Run Tabular Analysis Workbench

Browser-only app (File System Access API, OPFS, module worker, AG Grid). The agent path is
the Vite dev server plus `driver.cjs` next to this file: a Playwright script that stubs the
native file pickers with OPFS handles, loads a CSV, exercises the main flows and writes
screenshots. Paths below are relative to the repo root. Verified on macOS (arm64), Node 24.

## Prerequisites (once per machine)

Playwright lives in a scratch dir, not in the project's dependencies:

```bash
mkdir -p /tmp/twb-driver && cd /tmp/twb-driver && npm init -y >/dev/null && npm install --silent playwright@1.64 && npx playwright install chromium
```

Project deps: the repo's `node_modules` must be installed (`npm ci`).

## Run (agent path)

```bash
(nohup npm run dev -- --port 5199 --strictPort >| /tmp/twb-dev.log 2>&1 &); for i in $(seq 30); do curl -sf -o /dev/null http://localhost:5199/tabular-analysis-workbench/ && break; sleep 1; done; echo up
NODE_PATH=/tmp/twb-driver/node_modules node .claude/skills/run-tabular-analysis-workbench/driver.cjs; echo "exit=$?"
```

- `smoke` (default) loads a built-in tricky fixture (duplicate header, offset/µs timestamps,
  stray quote, quoted newline, extra/short rows, `=cmd|calc`, `007` IDs, 2000 bulk rows), then
  sorts, searches, filters by value, labels + undo/redo, opens timeline and profile, exports.
- `open` only loads and screenshots: `... driver.cjs open --csv /tmp/twb-mini.csv --light`
- `--csv FILE` uses your own file; `--light` emulates a light-mode OS (default dark).
- Output: `»` log lines on stdout, screenshots `1-loaded.png` … `6-profile.png` and the
  exported `export.csv` in `/tmp/twb-shots` (`TWB_OUT` overrides; `TWB_URL` overrides the URL).
- Exit code 1 if any step failed or the page logged a console error / HTTP ≥ 400.
  **Look at the screenshots** - a passing run with a broken layout is still broken.

Expected smoke output includes `Showing 2,005 of 2,005 rows • 2 malformed rows`, first sorted
timestamp `2024-01-01T09:30:00+02:00`, and the export row `"'=cmd|calc"`.

To add a flow, add a `step('name', async () => …)` block in `driver.cjs`; reuse `cell(row, col)`,
`status()` and `shot(name)`.

Stop the server:

```bash
lsof -ti:5199 -sTCP:LISTEN | xargs kill
```

## Run (human path)

`npm run dev`, open the printed URL (it ends in `/tabular-analysis-workbench/`) in a
Chromium-based browser, click **Open Files**. Useless headless - the picker is a native dialog.

## Test

```bash
npm run lint && npx tsc -p tsconfig.json --noEmit && TZ=Europe/Paris npx vitest run && npm run build
```

CI runs tests with `TZ=Europe/Paris`; some datetime tests assume a non-UTC zone.

The Playwright e2e + axe suite (`e2e/`, same picker stubs as the driver, in `e2e/fixtures.ts`)
starts its own dev server on port 4174 - prefer adding a spec there over growing the driver:

```bash
npx playwright install chromium && npm run e2e
```

## Gotchas

- **The app is served under `/tabular-analysis-workbench/`** (Vite `base`). `/` returns 404.
- **Native pickers can't run headless.** The driver replaces `showOpenFilePicker` /
  `showSaveFilePicker` via `addInitScript` with OPFS `FileSystemFileHandle`s; the fixture is
  written into OPFS first, and exports are read back from OPFS (`saved-<suggestedName>`).
- **Playwright pins a browser build.** 1.64 wants `chromium-1248`; an older cached build
  (e.g. `chromium-1234`) does not count - run `npx playwright install chromium` from
  `/tmp/twb-driver`, don't hardcode `executablePath`.
- **The light theme follows the OS on first load** (`prefers-color-scheme`), then persists in
  `localStorage` `wlx:preferences`. Headless Chromium prefers light unless `colorScheme` is set;
  the driver sets it explicitly. Each driver run is a fresh context, so no state leaks.
- **Grid DOM:** no pinned/centre split - select cells with `.ag-row[row-index=N] [col-id=K]`.
  The Labels column id is `__tag`. Headers are a custom component: the first `button` in
  `.ag-header-cell[col-id=K]` toggles sort; right-click (or "Open K menu") opens the column menu.
  Duplicate headers are renamed (`user`, `user_2`).
- **Undo/redo shortcuts** (`Ctrl+Z`, `Ctrl+Shift+Z`) are ignored while an input has focus -
  click a neutral element (the `h1`) first.
- **Editing `index.html` while a driver runs** triggers a Vite full reload and the run dies with
  `Execution context was destroyed`. Re-run.
- The view pipeline is async (worker); the driver waits fixed 0.5–1 s after each action.
  Raise them if a slow machine gives stale `status` lines.

## Troubleshooting

- `Cannot find module 'playwright'` → you forgot `NODE_PATH=/tmp/twb-driver/node_modules`.
- Startup hangs or `up` prints but the driver can't connect → read `/tmp/twb-dev.log`. With zsh
  `noclobber`, plain `>` refuses to overwrite an old log, so the command uses `>|`.
- `Error: Port 5199 is already in use` → a previous server is still up; kill it with the stop command above.
- `HTTP 404 …/favicon.ico` in console errors → `index.html` lost its inline favicon `<link>`.
- `locator.click: Timeout` on a header → you targeted `.ag-header-cell-text`; it doesn't exist
  with the custom header, use `button`.
