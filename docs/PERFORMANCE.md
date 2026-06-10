# Performance — 10k-note benchmark & optimizations

Date: 2026-06-10 · Mode: browser dev server (`vite`, `MemoryVaultAdapter`) at `http://localhost:1420` · Machine: Windows 11, Chromium (Playwright).

## Bench vault

`MemoryVaultAdapter` seeds a synthetic vault when the page URL contains `?bench=N`
(e.g. `http://localhost:1420/?bench=10000`). Implementation: `makeBenchSeed(count)` in
`src/core/vault.ts`. No `VaultAdapter` interface change — only the constructor's
default seed is derived from `location.search`.

- N notes, 100 per folder (`Folder 000/Note 00000 …`), each 0.5–3 KB
- per note: 2–6 `[[wikilinks]]` to random other notes, 2–4 headings, 1–3 `#tags`
- deterministic LCG PRNG (seed 42, numerical-recipes constants) → byte-identical
  vault for a given N, fully reproducible runs
- at N=10,000: ~17 MB of markdown, ~40k links (fits the 30 MB content-cache budget)

## Methodology

All timings on a visible page (background tabs throttle `requestAnimationFrame`
to ~1 fps and corrupted a first measurement pass — do not trust rAF-based timing
in headless/occluded windows).

- **Load / index**: wall clock from `goto` until the first explorer row exists;
  `window.__geodePerf` exposes `benchSeedMs`, `metadataIndexMs`, `searchScanMs`,
  `switcherFilterMs`, `graphBuildMs` (instrumentation in `metadata.ts`,
  `QuickSwitcher.tsx`, `SearchPanel.tsx` — kept identical across before/after runs).
- **Per-keystroke latency**: native value setter + dispatched `input` event; React 18
  flushes discrete events synchronously, so `dispatchEvent` + forced layout
  (`offsetHeight`) captures render+commit+layout on the main thread.
- **Click-driven updates** (expand-all): programmatic clicks flush asynchronously, so
  a `MessageChannel` macrotask poll measures time until the DOM changes (immune to
  rAF throttling).
- Numbers are single representative runs; treat ±30% as noise.

## Results — bench=10000

| Metric | Before | After |
|---|---|---|
| Load → explorer interactive (wall) | 403 ms | 519 ms (noise; includes seed gen) |
| Bench seed generation | 96 ms | 140 ms (same code, run noise) |
| Metadata full index (10k files) | 105 ms | 118 ms (≈ parity, see notes) |
| Quick switcher open (main thread → rows) | **471 ms** (10,000 rows) | **15 ms** (100 rows) |
| Quick switcher per-key (10 keys, min–max) | **66–815 ms** | **6–24 ms** |
| Quick switcher filter compute only | 2.6 ms | 2.3 ms |
| Full-text search `graph` (worst case, incl. 250 ms debounce) | **2,585 ms** (9,744 blocks rendered) | **347 ms** (200 blocks; scan 53 ms) |
| Search scan (no render) | 53 ms | 53 ms |
| Explorer expand-all (100 → 10,100 rows) | **424 ms** (10,100 DOM nodes) | **10 ms** (~50 DOM nodes) |
| Explorer collapse-all | 39 ms | 9 ms |
| Graph build (`getGraph`, 10k nodes / ~40k links) | 149 ms | unchanged |
| Graph view frame rate | ~12 fps | unchanged (out of scope, see below) |

## Results — bench=1000 (control)

| Metric | Before | After |
|---|---|---|
| Load → explorer interactive | 201 ms | 208 ms |
| Bench seed generation | 15 ms | 21 ms |
| Metadata full index | 10 ms | 19 ms (noise) |
| Quick switcher open | 49 ms (1,000 rows) | 17 ms (100 rows) |
| Quick switcher per-key (min–max) | 1–66 ms | 2–20 ms |
| Full-text search `graph` (incl. debounce) | 447 ms (976 blocks) | 335 ms (200 blocks; scan 9 ms) |
| Explorer expand-all (10 → 1,010 rows) | 29 ms | 4 ms |
| Graph build / fps | 11 ms / 60 fps | unchanged |

## What was optimized (and what was not)

The profile was unambiguous: **compute is cheap, unbounded DOM is the bottleneck.**
Fuzzy-scoring all 10k files takes ~3 ms; full-text scanning 17 MB takes ~53 ms.
Rendering 10k React rows takes 400–2,300 ms. All fixes are render caps — no
cross-module API changed.

1. **QuickSwitcher** (`src/features/palette/QuickSwitcher.tsx`)
   - `MAX_RESULTS = 100` cap on rendered rows (both empty-query and filtered);
     all files are still scored, then sorted and truncated.
   - File list (`vault.getMarkdownFiles()`, an O(n) tree flatten) memoized per
     tree revision instead of recomputed per keystroke.
2. **SearchPanel** (`src/features/search/SearchPanel.tsx`)
   - `MAX_FILE_RESULTS = 200` cap on rendered file blocks. Every file is still
     scanned and ranked; the meta line reports true totals
     (`57340 results in 9744 notes · showing top 200`).
3. **Explorer** (`src/features/explorer/Explorer.tsx`)
   - Fixed-row-height (26 px, matches `.explorer-item`) windowed virtualization,
     active only above 200 visible rows — small vaults keep the full DOM so
     existing tests/behavior are untouched. Overscan 10 rows; spacer paddings
     preserve scrollbar geometry; keyboard selection scrolls by index when the
     selected row is outside the rendered window. Verified at scrollTop = middle
     of 10,100 rows: correct window (~50 DOM rows), rows clickable.
4. **MetadataIndex internals** (`src/core/metadata.ts`, exports unchanged)
   - `indexFiles` worker pool uses an index cursor instead of `Array.shift()`
     (was O(n²) element moves at 10k files).
   - `resolveLink` exact-path branch uses a maintained lowercase-path map
     (was an O(n) scan per path-style link; `getGraph`/backlinks call this per link).
   - At 10k the index was already ~100 ms (parse-bound), so these are hygiene
     fixes that matter more as N grows; measured delta is within run noise.

## Remaining bottlenecks & recommendations

- **Graph view at 10k nodes is the one unusable surface (~12 fps).** Build is fine
  (149 ms); the cost is d3-force ticks + full Canvas2D redraw of 10k nodes /
  ~40k edges every frame. `GraphView.tsx` was out of scope for this task.
  Recommended, in order of value:
  1. stop redrawing once the simulation alpha settles (render-on-demand);
  2. degree-based sampling / "top N nodes" toggle above ~3k nodes;
  3. move the simulation to a Web Worker;
  4. WebGL renderer (regl / pixi) for the 10k+ tier — Canvas2D will not get there.
- **Search debounce (250 ms) now dominates** perceived search latency (scan is
  53 ms at 10k). Could drop to ~150 ms, or make it adaptive to vault size.
- **Full-text search re-reads the vault each query** through the content cache
  (30 MB budget). Fine in memory mode; on desktop (Tauri IPC) a 10k cold query
  would pay IPC per file. A persistent inverted/trigram index is the long-term
  answer for desktop vaults.
- Quick switcher cap has no recency/frecency ranking; with 10k notes the top-100
  cutoff is occasionally arbitrary for 1–2 character queries.
- Explorer virtualization assumes the 26 px row height in `explorer.css`; if that
  changes, `ROW_HEIGHT` in `Explorer.tsx` must follow (single constant).
- `getBacklinks` is O(total links) per call (~40k resolves at 10k notes, each O(1)).
  Fine today; an inverted link index inside `MetadataIndex` would make it O(degree)
  if the backlinks panel ever shows jank.

## Reproducing

```text
npm run dev
# browser: http://localhost:1420/?bench=10000   (or ?bench=1000)
# console: window.__geodePerf  → { benchSeedMs, metadataIndexMs, switcherFilterMs, searchScanMs, graphBuildMs }
```

Navigate back to `http://localhost:1420/` (no params) to return to the demo vault;
the bench vault is never persisted.
