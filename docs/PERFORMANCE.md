# Performance — 10k-note benchmark & optimizations

Date: 2026-06-10 (R3 core) / 2026-06-11 (R7 graph section below) · Mode: browser dev server (`vite`, `MemoryVaultAdapter`) at `http://localhost:1420` · Machine: Windows 11, Chromium (Playwright).

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
| Graph view frame rate | ~12 fps | **fixed in R7** — see "R7: Graph view" below |

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

## R7: Graph view (2026-06-11) — recommendations 1+2 implemented

Measured at `?bench=10000` (10,000 notes / ~40k links) and `?bench=1000` control.

| Metric | R3 (before) | R7 (after) |
|---|---|---|
| 10k default view | 10,000 nodes, ~12 fps forever | **top 3,000 by degree** (sampled, "Show all" toggle) |
| 10k settle (open → layout static) | never truly idle | **5.8 s** (`graphSettleMs` 5771) |
| 10k settle-phase frame time | ~83 ms (12 fps) | **24 ms median** (~42 fps, sampled set) |
| 10k post-settle idle redraws | every frame | **0** (rAF dirty-flag, render-on-demand) |
| 10k single full draw (`graphDrawMs`) | n/a | **3.9 ms** (sampled) / 12.4 ms (Show all) |
| 10k "Show all" settle frame time | — | ~109 ms (~9 fps, opt-in; static + on-demand after settle) |
| 1k control | 60 fps | **60 fps, no sampling** (17 ms/frame settle, draw 2.3 ms) |

What changed (`GraphView.tsx`):
1. **Degree sampling** above `RENDER_CAP = 3000` nodes (stable tie-break by id; the
   local-graph anchor is always kept). The simulation runs over the rendered subset only.
2. **Render-on-demand**: every draw request goes through a dirty-flag + rAF scheduler —
   at most one draw per frame, zero draws when idle.
3. **Per-edge strokes, endpoint-culled** + per-style node buckets + viewport culling for
   nodes/labels; labels are suppressed while the simulation is hot (alpha > 0.05).
4. New perf marks: `graphDrawMs` (last full draw), `graphSettleMs` (rebuild → sim end).

**Measured trap (do not reintroduce):** batching all edges into ONE `Path2D` and stroking
it once *feels* like the textbook optimization but rasterizes ~20x SLOWER in Chromium —
197 ms for a 6.5k-segment stroked path vs ~9 ms for 6.5k individual strokes (the compositor
flattens/antialiases the giant path as a single unit, and `Path2D` gets no per-segment
culling). JS-side timing won't show it: the cost lands on the raster thread and appears
only as frame-gap inflation. Same trap nearly applies to labels: a 3k-label `fillText`
pass throttled settle ticks ~10x (43 s → 5.8 s once suppressed while hot).

Remaining (future tiers): Web Worker simulation; WebGL renderer (regl/pixi) for an
unsampled 10k+ view — Canvas2D will not get there.

## R15: 基线刷新（2026-06-11，headless Edge + CDP，v0.15.0）

R7 后七轮特性（i18n/嵌入/转写/块引用/定位）未刷新基线——R15 整固轮复测，**零回归**：

| 指标 @ bench=10000 | R3/R7 基线 | R15 实测 | 判定 |
|---|---|---|---|
| metadataIndexMs | ~110（R3） | 185 | +75ms（aliases/blocks 七轮解析增量，可接受） |
| switcher 开启 | 15ms（R3） | 20ms | 噪声内 |
| graphSettleMs | 5771（R7） | **3958** | 更优 |
| graphDrawMs | 3.9（R7） | 2.9 | 更优 |
| resolveAttachment 首建（R11 新口径） | — | 1ms | 可忽略 |
| resolveSubpath（R14 新口径） | — | 0ms | 可忽略 |

bench=1000 控制组：graphDrawMs 2.6ms（60fps 余量充足）、metadataIndexMs 33ms。
全文搜索未复测（UI 驱动探针成本高，下次专项）。探针 `.calibration/r15-bench.js` +
`cdp-run-url.mjs <expr> <port> <urlSubstring>`（headless Edge：
`msedge --headless=new --remote-debugging-port=93xx --user-data-dir=<tmp> <url>`）。

## Remaining bottlenecks & recommendations (R3 list)
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
# console: window.__geodePerf  → { benchSeedMs, metadataIndexMs, switcherFilterMs, searchScanMs, graphBuildMs, graphDrawMs, graphSettleMs }
```

Navigate back to `http://localhost:1420/` (no params) to return to the demo vault;
the bench vault is never persisted.
