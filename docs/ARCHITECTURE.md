# Geode Architecture Contract

Geode is an Obsidian-style local-first markdown knowledge base.
Stack: **Tauri 2 (Rust shell) + React 18 + TypeScript (strict) + Vite + CodeMirror 6**.

## Layering — who may import what

```
src/core/      pure TS, NO React components (only hooks in store.ts / i18n.ts). Never imports features/app.
               (May import @codemirror/* — the shared document model lives here.)
src/app/       shell: App.tsx layout, AppContext, icons. Imports core + feature entry components
               + compat (bootstrap wiring only).
src/features/  one folder per feature. Imports core + app/AppContext + app/icons ONLY.
               NEVER import from another feature folder. NEVER import compat.
src/plugins/   built-in plugins (GeodePlugin[]). Imports core only.
src/compat/    Obsidian plugin compatibility layer (R4+). Imports core ONLY.
               Self-contained: own CSS, own DOM helpers. Never imported by features.
```

Path aliases: `@core/*`, `@features/*`, `@app/*`, `@compat/*` (see tsconfig).

## Core API (read these files before coding)

- `core/types.ts` — all shared types. Paths are vault-relative, forward slashes.
- `core/store.ts` — `Store<T>` observable + `useStore(store)` React hook. All shared state.
- `core/events.ts` — typed `EventBus`. Events: `vault:changed`, `file:modified|created|deleted|renamed`, `metadata:updated`, `active-file:changed`, `theme:changed`.
- `core/vault.ts` — `Vault` (use this, never the adapter): `tree` store, `read/readCached/modify/create/createFolder/rename/remove`, `getFiles()/getMarkdownFiles()/fileExists/uniquePath`. Adapters: Tauri (desktop fs) & Memory (browser demo/E2E).
- `core/metadata.ts` — `MetadataIndex`: `revision` store (subscribe via `useStore` to re-render on index change), `getMetadata(path)`, `resolveLink(target, fromPath)`, `getBacklinks(path)`, `getOutgoingLinks(path)`, `getTagMap()`, `getGraph()`, plus `parseNote()` pure parser.
- `core/workspace.ts` — `Workspace`: `state` store (`WorkspaceState`), `openFile(path, {newTab})`, `openGraph()`, `closeTab/setActiveTab/setTabMode/toggleActiveTabMode`, `setLeftPanel/toggle*Sidebar`, `openModal/closeModal`, `setTheme/toggleTheme/setFontSize`, `getActiveTab()/getActiveFile()`.
- `core/commands.ts` — `CommandRegistry`: `register({id, name, hotkey?, callback})` → disposer, `execute(id)`, `list()`, `revision` store. Hotkeys handled globally by App shell.
- `core/plugins.ts` — `GeodePlugin { id, name, onload(app: AppHandle), onunload? }`, `PluginManager` (`list()`, `enable/disable`, `statusBarItems` store). `AppHandle.ui.setStatusBarItem(id, text)`.

## Using app context in feature components

```tsx
import { useApp } from "@app/AppContext";
import { useStore } from "@core/store";

function MyPanel() {
  const app = useApp();                       // { vault, metadata, workspace, commands, events, plugins }
  const ws = useStore(app.workspace.state);   // re-renders on workspace change
  const rev = useStore(app.metadata.revision); // re-renders on index change
  ...
}
```

To navigate: `app.workspace.openFile(path)`. To create-from-unresolved-link:
`await app.vault.create(app.vault.uniquePath(folder, name)); app.workspace.openFile(path)`.

## Styling rules

- Use the CSS variables in `src/styles/app.css` (`--bg-panel`, `--text-muted`, `--accent`, `--border`, ...). Never hard-code colors.
- Shared classes available: `.modal-overlay` + `.modal-panel` (modals), `.panel-header` (+`.panel-actions`) for sidebar panels.
- Each feature adds its own CSS file inside its folder and imports it from its component (`import "./explorer.css"`).
- Look & feel target: Obsidian — dense, quiet, keyboard-first. 13–14px UI font, subtle hovers.
- Add `data-testid` attributes on key interactive elements (used by E2E).

## Component contracts (App.tsx imports these — keep signatures EXACTLY)

| File | Export | Props |
|---|---|---|
| `features/explorer/Explorer.tsx` | `Explorer` | none |
| `features/search/SearchPanel.tsx` | `SearchPanel` | none |
| `features/editor/EditorPane.tsx` | `EditorPane` | `{ tab: TabState }` (re-mounted per tab via key) |
| `features/graph/GraphView.tsx` | `GraphView` | none |
| `features/backlinks/BacklinksPanel.tsx` | `BacklinksPanel` | none (reads active file from workspace) |
| `features/palette/CommandPalette.tsx` | `CommandPalette` | none, renders own `.modal-overlay`; close via `app.workspace.closeModal()` |
| `features/palette/QuickSwitcher.tsx` | `QuickSwitcher` | none, same modal rules |
| `features/settings/SettingsModal.tsx` | `SettingsModal` | none, same modal rules |
| `plugins/index.ts` | `BUILTIN_PLUGINS: GeodePlugin[]` | — |

Escape key closing is handled globally by the shell; modals must ALSO close on overlay click.

## Round 8 additions (current) — i18n（中/英）+ watcher 回声抑制

Native round（compat 表面零改动——套件只需不回退）。No new npm deps（i18n 手写，不引 i18next）。

### Core: i18n — `core/i18n.ts` (new) + `core/i18n/dict.*.ts` (new, 3 fragments)

Layering amendment: `core/i18n.ts` is the SECOND hooks exception besides store.ts
(pure TS + one React hook; never imports components).

```ts
export type Locale = "en" | "zh";
export type I18nKey = keyof typeof en;   // en = merged fragment dictionaries
/** singleton — current locale. Initial: localStorage "geode.locale" if valid,
 *  else navigator.language startsWith("zh") → "zh", else "en". */
export const locale: Store<Locale>;
export function setLocale(l: Locale): void;  // sets store + persists localStorage
/** Translate: current-locale dict → en fallback → the key itself (never throws).
 *  Params interpolate "{name}"-style placeholders. */
export function t(key: I18nKey, params?: Record<string, string | number>): string;
/** React hook: subscribes to `locale` (useStore) and returns `t` — components
 *  re-render on locale switch. Usage: `const t = useI18n();` */
export function useI18n(): typeof t;
```

- **Dictionary fragments** (one per sweep agent — exclusive ownership, no merge
  conflicts): `core/i18n/dict.app.ts`, `dict.panels.ts`, `dict.views.ts`, each
  `export const en = { ... } as const;` + `export const zh: Record<keyof typeof en, string> = { ... };`
  `core/i18n.ts` spreads them: `const en = { ...appEn, ...panelsEn, ...viewsEn }`.
  Key namespaces match the fragment: `app.*`/`cmd.*`/`plugin.*` (dict.app),
  `explorer.*`/`search.*`/`backlinks.*`/`outline.*`/`palette.*`/`switcher.*` (dict.panels),
  `settings.*`/`graph.*`/`editor.*`/`export.*` (dict.views).
- **Scope**: every user-visible string in src/app, src/main.tsx, src/features,
  src/plugins — JSX text, placeholder/title/aria-label, command names, empty states,
  toasts, confirm dialogs. **NOT in scope**: console.* messages (stay English),
  src/compat/** (untouched this round), data-testid values, localStorage keys.
- **Persisted strings stay language-neutral**: tab titles persist in workspace
  state — the graph tab's stored title is ignored at render time (tab strip renders
  `t("app.graphTab")` when `viewType === "graph"`); file tabs keep the basename.

### Core: command names become translatable — `core/types.ts` + `core/commands.ts` (chief, pre-phase)

```ts
// types.ts
interface Command { name: string | (() => string); ... }   // string still valid (compat passes strings)
// commands.ts
export function getCommandName(cmd: Command): string;       // resolves the thunk
```

- Native registrations switch to `name: () => t("cmd.xxx")` — NO re-registration on
  locale switch; display sites resolve at render time.
- `CommandRegistry.list()` sorts via `getCommandName`. All display/filter sites
  (CommandPalette fuzzy + chips, SettingsModal hotkeys rows + conflict labels) use
  `getCommandName` and subscribe to locale via `useI18n()`.

### Settings: language picker — `features/settings/SettingsModal.tsx` (Appearance section)

Setting row "Language / 语言": `<select data-testid="settings-language">` with options
`en` → "English", `zh` → "中文" (option labels are SELF-named, never translated).
onChange → `setLocale`. Locale persists across reload.

### 中文术语表（zh 文案统一口径，向 Obsidian 中文社区习惯对齐）

vault=库 · note=笔记 · tab=标签页 · pane=窗格 · backlinks=反向链接 · outgoing links=出链 ·
outline=大纲 · graph view=关系图谱 · command palette=命令面板 · quick switcher=快速切换 ·
live preview=实时预览 · reading view=阅读视图 · source mode=源码模式 · appearance=外观 ·
hotkeys=快捷键 · theme=主题 · dark/light=深色/浅色 · export=导出 · tag=标签 ·
folder=文件夹 · daily note=日记 · word count=字数 · status bar=状态栏 · sidebar=侧边栏 ·
unresolved=未创建 · settings=设置 · plugin=插件。语气：简体中文、不加句号的短标签、
按钮用动词短语（"新建笔记"），空状态用完整句（"打开笔记以查看其反向链接。"）。

### Core: watcher echo suppression — `core/vault.ts` ONLY

Self-writes echo back through the fs watcher today (full refreshTree + double
reload reads per save, downstream equality makes it a no-op). Suppress at the source:

- `modify()`/`create()` record `recentSelfWrites: Map<path, { hash, at }>`
  (FNV-1a 32-bit over the written content, local helper) **BEFORE** awaiting
  `adapter.writeFile` (the echo can arrive while the write promise is pending).
  Entries expire after 10s (TTL pruned opportunistically); a newer write to the
  same path overwrites the entry. Entries are KEPT until expiry (notify may
  deliver several echo batches for one write).
- `handleExternalChanges(paths)` partitions first: a path with a fresh entry →
  `adapter.readFile` + hash compare. Match → **suppressed**: keep the content
  cache (it IS the written content — no cacheDelete), emit nothing for this path.
  Mismatch or read error → delete the entry, treat as a real external change.
- ALL paths suppressed → return before `refreshTree` (the main win: zero work per
  auto-save echo). Otherwise the existing pipeline runs for the surviving paths only.
- Deletes/renames/folders: out of scope — only paths with recorded entries are
  ever suppressed; everything else keeps current behavior.
- Probes: `window.__geodeWatchEcho = { suppressed, external }` counters (both ends,
  cheap, always on). `MemoryVaultAdapter.startWatch` additionally registers
  `window.__geodeFireWatch = (paths: string[]) => onChange(paths)` so browser E2E
  can simulate watcher events (desktop notify path is exercised in the desktop pass).

### As-built deltas (post-review, adversarially verified — R8)

Review: 5 dimensions, 10 findings → 5 confirmed (ALL downgraded to minor by adversarial
verification — zero surviving major/critical), 5 refuted. Disposition:

- **FIXED — failed writes clear their fingerprint**: `modify()`/`create()` wrap the adapter
  write in try/catch; on failure `clearSelfWrite(path, content)` removes the entry only if
  it still belongs to that write (hash equality — a newer concurrent write keeps its own).
  Without this, a failed write's fingerprint could suppress a byte-identical REAL external
  change within the 10s TTL.
- **Recorded limitation (no code change)** — un-awaited concurrent `modify()` calls to the
  same path keep only the LAST fingerprint; an echo of the first write hashes as external →
  one redundant refresh + spurious external events. Downstream is fully guarded (dirty
  check + content-equality no-op; `vault:external-changed` has zero subscribers) and the
  failure direction is safe-by-design (mis-classify as external, never mis-suppress).
- **Recorded limitation (no code change)** — strings resolved at CM6 view/widget BUILD time
  (editor placeholder, task-checkbox aria-label, frontmatter pill) keep the previous locale
  until the view/widget rebuilds (mode switch / tab reopen / editing the line). Intentional:
  rebuilding live editors on locale switch risks editor state for an a11y label. Noted in
  code comments at each site.
- Refuted (not defects, examples): non-md external creates emitting `file:created` is
  pre-existing R2 behavior untouched by the partition; `Record<keyof typeof en, string>`
  exactly matches the contract's fragment shape; ErrorBoundary's imperative `t()` is a
  terminal page (no live switch reachable).

### Round 8 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| watcher | core/vault.ts ONLY |
| sweep-app | app/App.tsx, src/main.tsx, src/plugins/*.ts, core/i18n/dict.app.ts |
| sweep-panels | features/explorer/*, features/search/*, features/backlinks/*, features/outline/*, features/palette/*, core/i18n/dict.panels.ts |
| sweep-views | features/settings/*, features/graph/*, features/editor/* (strings only), features/export/*, core/i18n/dict.views.ts |

Pre-phase (chief, before agents start): this section + `core/i18n.ts` complete +
3 fragment stubs + `Command.name` widening + `getCommandName` — tsc green at the
starting line. Frozen cross-agent surfaces: the `core/i18n.ts` API block, the
fragment file shape, `getCommandName`, `data-testid="settings-language"`,
`window.__geodeFireWatch` / `__geodeWatchEcho`. Every agent runs `npx tsc --noEmit`
before finishing; no agent touches another's files; no new npm deps.

## Round 7 additions — 图谱打磨（fit/局部图谱/10k 性能）+ 导出 HTML/PDF

Native round (no obsidian API surface change — compat suite must simply not regress).

### Core: last-active-file tracking — `core/workspace.ts`

```ts
// Workspace addition:
/** Most recent NON-NULL active file (survives switching to the graph tab / modals).
 *  Session-only — not persisted. Seeded from the active tab on load. */
readonly lastActiveFile: Store<string | null>;
```

Updated wherever `active-file:changed` is emitted with a non-null path (single choke point —
find the emit site and tap it; do NOT add a second source of truth). Switching to a graph tab
or closing the file does NOT clear it. The graph view's local mode subscribes to this store.

### Graph view — `features/graph/` (GraphView.tsx + graph.css, feature-internal)

**Toolbar** (`.graph-toolbar`, top-left, must not block canvas drag elsewhere):
mode toggle Global/Local (`data-testid="graph-mode-global"` / `"graph-mode-local"`),
depth select 1|2 shown in local mode (`data-testid="graph-depth"`),
fit button (`data-testid="graph-fit"`). UI prefs persist to localStorage
`"geode.graphPrefs"` as `{ mode: "global"|"local", depth: 1|2, showAll: boolean }`
(corrupt/missing → defaults global/1/false).

**Fit-to-view + centering fix (R3 debt)**:
- `fitToView()` — bounding box over RENDERED node positions (+node radius + ~40px padding)
  → transform centers the bbox in the viewport, `k` clamped to [MIN_ZOOM, 1.5].
- Auto-fit triggers: once when the first simulation settles (sim "end") unless the user has
  panned/zoomed since mount (interaction flag); after every local-mode re-anchor.
- Root-cause the maximized-window offset (acceptance: open graph in a maximized window →
  visually centered; maximize/restore AFTER open → still centered). The existing
  keep-viewport-center resize compensation may stay, but the initial mount must measure the
  real laid-out rect.

**Local mode**:
- Anchor = `workspace.lastActiveFile` resolved to a graph node id; BFS over the adjacency map
  to depth ≤ N (1|2), unresolved neighbors included; simulation runs over the SUBGRAPH only.
- Anchor node: accent ring + label always visible. Anchor change → existing 250ms debounced
  rebuild path + auto-fit. No anchor (null / not in graph) → empty-state card
  "Open a note to see its local graph." (`data-testid="graph-local-empty"`).

**10k performance** (PERFORMANCE.md recommendations 1+2; targets measured at `?bench=10000`):
- **Degree sampling**: `RENDER_CAP = 3000` nodes. `nodes > cap && !showAll` → keep top-cap by
  degree (stable tie-break by id), edges among kept nodes only, simulation over the sample;
  legend shows "top 3,000 of 10,212 nodes" + toggle button (`data-testid="graph-show-all"`).
- **Draw batching**: all non-highlighted edges in ONE `beginPath`/`stroke`; nodes bucketed by
  fill style; labels and nodes outside the viewport (±margin) are culled. Hover state may
  redraw only via the batched path (no per-edge stroke loops).
- **rAF coalescing**: every internal draw request goes through a dirty-flag +
  `requestAnimationFrame` scheduler — at most one canvas draw per frame, zero draws when idle
  (post-settle, no interaction).
- Perf marks on `window.__geodePerf`: `graphDrawMs` (last full draw), `graphSettleMs`
  (rebuild → sim end). PERFORMANCE.md gains a before/after table for bench=10000 and
  bench=1000 (no regression at 1k: 60fps).

### Export — `core/export.ts` (new) + `features/export/` (new) + Rust

`core/export.ts` (mirrors core/net.ts dual-end pattern, uses `isTauri()` from core/vault):

```ts
export interface SaveTextFileOptions {
  suggestedName: string;   // e.g. "Welcome.html"
  filterName: string;      // e.g. "HTML"
  extensions: string[];    // e.g. ["html"]
}
/** Desktop: native save dialog (@tauri-apps/plugin-dialog) + `export_write` command.
 *  Browser: Blob + anchor download (always resolves "saved"). */
export function saveTextFile(
  content: string,
  opts: SaveTextFileOptions,
): Promise<"saved" | "cancelled">;
```

Rust `export_write` (src-tauri/src/main.rs):
`#[tauri::command(async)]` (file IO off the main thread — R6 lesson)
`fn export_write(path: String, content: String) -> CmdResult<()>` — ABSOLUTE path as returned
by the save dialog; reject relative paths; write UTF-8; parent dir must already exist
(the dialog guarantees it). No safe_join — exporting outside the vault is the point;
the path always comes from a user-driven native dialog.

`features/export/` (export.ts + export.css):
- `buildStandaloneHtml({ title, bodyHtml }): string` — complete standalone document with an
  INLINE `<style>` (self-contained reading-view subset: typography, headings, code, blockquote,
  tables, tag pills, disabled task checkboxes, internal/external link colors — light,
  print-friendly, independent of the app theme). Import the css as a string via Vite `?raw`.
- `exportActiveNoteHtml(app)` — active file → `vault.read` → `renderMarkdownToHtml(content,
  target => metadata.resolveLink(target, path))` → `saveTextFile`. Internal links become
  non-navigating styled text (href="#", no JS in the export).
- `printActiveNote(app)` — same html into a `#geode-print-root` div appended to body;
  `@media print` hides `#root` and shows only the print root; `window.print()`;
  cleanup on `afterprint` (and a safety timeout). Desktop WebView2 print dialog includes
  "Microsoft Print to PDF" — that IS the PDF export path (documented, no extra dep).
- Commands registered in App.tsx beside the existing ones:
  `app:export-html` ("Export note as HTML…"), `app:export-pdf` ("Export note as PDF (print)…"),
  both with `available: () => workspace.getActiveFile() !== null`.
- Browser E2E hooks: the download anchor must carry `data-testid="export-download"` long
  enough for Playwright's download event; print path exposes `window.__geodeLastPrintHtml`
  (dev-only probe, set before `window.print()` and in browser E2E `print` may be stubbed).

### As-built deltas (post-review + runtime verification — R7)

Review: 5 dimensions, 18 findings confirmed (8 unique root causes), 0 refuted. Browser
verification then caught 2 ADDITIONAL runtime bugs the static review missed. All fixed:

- **`lastActiveFile` is remapped directly in `handleRenamed`** (equal path + folder-prefix
  branches) — the emitActiveFile choke point can't see a rename while a non-markdown tab
  (graph) is active: `getActiveFile()` is null and the non-null guard keeps the stale path,
  blanking the local graph for a still-open note. `handleDeleted` clears a deleted anchor;
  `openVaultFlow` resets the store before `vault.load()` (old-vault relative paths must
  never anchor the local graph in a new vault).
- **Export reads the LIVE document buffer first**
  (`app.documents.get(path)?.getText() ?? await vault.read(path)`) — vault.read returns the
  last *saved* content; with the 600ms save debounce an export right after typing silently
  missed the latest edits.
- **Export surfaces its outcome** — `exportActiveNoteHtml` never rejects: success/failure
  shows a transient toast (`data-testid="export-notice"`, styles in `notice.css`, kept OUT
  of export.css which ships inside every exported file). Previously a failed disk write
  died as an unhandled rejection behind the already-closed save dialog.
- **`export_write` writes a sibling temp file + rename** — `fs::write` truncates before
  writing; a mid-write failure (disk full, kill) must never destroy the user-chosen
  existing file.
- **Print re-entry settles the previous print** via a module-level `pendingPrintCleanup`
  (listener + timer + `document.title` restore), not just DOM removal — back-to-back prints
  were cross-restoring titles when `afterprint` never fired.
- GraphView: the full-graph adjacency is built only in the local branch (global built and
  dropped an O(E) map per rebuild); user pan/zoom also cancels a PENDING re-anchor
  settle-fit (not just the first-settle fit).
- **[runtime-only] rAF id reset on unmount cleanup** — `cancelAnimationFrame` without
  `rafRef.current = 0` left a stale truthy id after StrictMode's dev double-mount, making
  every future `requestDraw` early-return: the canvas stayed BLANK forever in dev while
  legend/toolbar looked alive. Static review missed it; only a screenshot caught it.
- **[runtime-only] per-edge strokes, NOT a batched mega-`Path2D`** — one 6.5k-segment
  stroked path rasterizes in ~197ms vs ~9ms for individual strokes (20x, compositor-side,
  invisible to JS timing); plus label suppression while the sim is hot (a 3k `fillText`
  pass throttled settle 43s → 5.8s). Numbers + "do not reintroduce" note in PERFORMANCE.md.

### Round 7 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| graph | features/graph/GraphView.tsx, features/graph/graph.css, core/workspace.ts (lastActiveFile ONLY) |
| export | core/export.ts (new), features/export/* (new), app/App.tsx (command registration ONLY), src-tauri/src/main.rs (export_write + invoke_handler list ONLY) |

Frozen cross-agent surfaces: `Workspace.lastActiveFile`, `saveTextFile` signature, the two
command ids. Neither agent touches the other's files; both run `npx tsc --noEmit` (and the
export agent `cargo check`) before finishing.

## Round 6 additions — compat 余项（EditorSuggest 真实触发 / MarkdownRenderer / requestUrl）+ 快捷键自定义

Calibration source: **`.calibration/API-REFERENCE-R6.md`** (generated 2026-06-10 from official
obsidian.d.ts + suite main.js call-site scans). Implement EXACTLY against it.
Suite facts that drive this contract:
- The suite has **ZERO callers** of MarkdownRenderer/requestUrl — both are implemented to the
  official d.ts shape only, no suite-specific accommodation needed.
- nldates' DateSuggest (the EditorSuggest unlock) additionally needs: `this.scope.register(
  ["Shift"], "Enter", cb)` (a REAL Scope), `this.setInstructions(...)`, **the non-public
  `this.suggestions.useSelectedItem(evt)`**, context.start reuse across keystrokes,
  `editor.getRange/replaceRange`, `el.setText`, `vault.getConfig("useMarkdownLinks")` (exists).
- onTrigger officially fires "very often (on each keypress)" — we drive it from the
  `document:changed` core event (per local transaction). Cursor-move-only re-evaluation is a
  recorded deviation (suite unaffected).

### Core: hotkey overrides — `core/commands.ts`

```ts
// CommandRegistry additions (all bump `revision`):
getEffectiveHotkey(id: string): string | null;      // override ?? command.hotkey ?? null
setHotkeyOverride(id: string, hotkey: string | null): void; // null = explicitly unbound; persists
clearHotkeyOverride(id: string): void;              // back to the command's default; persists
hasHotkeyOverride(id: string): boolean;
findHotkeyConflicts(hotkey: string, excludeId?: string): Command[]; // normalized effective-hotkey match
export function normalizeHotkey(hotkey: string): string; // canonical "Ctrl+Alt+Shift+Key" (Mod→Ctrl)
```

- Overrides persist to localStorage `"geode.hotkeyOverrides"` as `Record<string, string | null>`
  (same global-key pattern as the plugin enabled-set). Unknown command ids are kept (a plugin
  may register later).
- `handleKeydown` matches EFFECTIVE hotkeys only. `matchHotkey` keeps its signature.
- CommandPalette displays `getEffectiveHotkey(cmd.id)` instead of `cmd.hotkey`.

### Core: markdown pipeline extraction — `core/markdown.ts` (new)

The markdown-it pipeline moves VERBATIM from `features/editor/preview.ts` to `core/markdown.ts`
(core may import markdown-it; no React). Exports:
`renderMarkdownToHtml(source: string, resolve: (target: string) => string | null): string`
(wikilinks/tags/task checkboxes — semantics unchanged).
`features/editor/preview.ts` keeps its exports (`renderPreview`, `toggleTaskOnLine`) — 
`renderPreview` becomes a thin delegate; EditorPane is untouched.

### Core: HTTP transport — `core/net.ts` (new)

```ts
export interface HttpRequestParams { url: string; method?: string;
  headers?: Record<string, string>; contentType?: string;
  bodyText?: string; bodyBase64?: string; }
export interface HttpResponseData { status: number;
  headers: Record<string, string>; bodyBase64: string; }
/** Tauri: invoke("http_request") — CORS-free. Browser: fetch (CORS-bound; rejects on network error). */
export function httpRequest(params: HttpRequestParams): Promise<HttpResponseData>;
```

Pure transport: never throws on HTTP status (4xx/5xx return normally) — `throw` semantics live
in the compat layer. Browser path reads the response as ArrayBuffer → base64.

### Rust: `http_request` command (src-tauri)

One-time dep decision (chief): **`ureq = "2"` (rustls) + `base64 = "0.22"`** in Cargo.toml —
implementation agents still must not add further deps. Command (serde camelCase,
**`#[tauri::command(async)]` — a plain sync command runs ON the main thread in Tauri 2 and a
blocking 30s request would stall the event loop and every queued vault_* command**):
`http_request(req: HttpRequest) -> CmdResult<HttpResponse>` where HttpRequest
`{ url, method?, headers?, bodyBase64? }`, HttpResponse `{ status, headers, bodyBase64 }`.
Method defaults GET; 30s timeout; redirects followed (ureq default); 4xx/5xx are NOT errors
(`ureq::Error::Status` maps to a normal response); duplicate response headers join with ", ".
Only http/https URLs accepted (anything else → CmdResult error).

### Compat: requestUrl / request — `util.ts`

Implement per API-REFERENCE-R6 (official shapes):
- `requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise` over
  `core/net.httpRequest`. The returned object is a Promise PLUS `arrayBuffer/json/text`
  promise properties (official RequestUrlResponsePromise).
- Resolved `RequestUrlResponse`: `status`, `headers`, and `arrayBuffer/json/text` as
  PROPERTIES (not methods): text = utf-8 decode, json = lazy JSON.parse(text),
  arrayBuffer = base64 decode.
- `throw` defaults true → status ≥ 400 rejects with a descriptive Error; `throw: false`
  resolves normally.
- `body: string | ArrayBuffer` maps to bodyText/bodyBase64; `contentType` becomes the
  Content-Type header (explicit `headers["Content-Type"]` wins).
- **`data:` URLs are resolved in-layer** (no network, both ends — the deterministic fixture
  path). `export function request(req): Promise<string>` = `requestUrl(req).text`.
- Remove the requestUrl gap plumbing. Network failures reject with the transport error.

### Compat: MarkdownRenderer — `util.ts`

- `static async render(app, markdown, el, sourcePath, component)`: html =
  `renderMarkdownToHtml(markdown, target => metadata.resolveLink(target, sourcePath))` from
  the CURRENT loader context (module-level handle, see below); `el.innerHTML = html`
  (markdown-it runs html:false — no raw-HTML injection); add `.markdown-rendered` class;
  one delegated click listener wires `.internal-link` → `workspace.openFile(resolved)`;
  task checkboxes render disabled (no source mapping for plugin-rendered fragments).
  When `component` looks like a Component (`typeof component?.register === "function"`),
  register the listener teardown there.
- `static renderMarkdown(markdown, el, sourcePath, component)` (deprecated 4-arg) delegates.
- Module-level current-handle plumbing: `context.ts` calls `_setCompatHostHandle(handle)`
  on create and `_setCompatHostHandle(null)` in dispose; `render` falls back to the `app`
  argument's internal handle when module handle is absent. Remove the MarkdownRenderer gap
  reporting.

### Compat: EditorSuggest real triggering — `suggest.ts` + `ui.ts` + `plugin.ts` + `context.ts`

- `ui.ts` Scope becomes REAL: stores `{ modifiers, key, func }` handlers;
  `register(modifiers: Modifier[] | null, key: string | null, func): KeymapEventHandler`
  (returns `{ modifiers, key, scope }`); `unregister(handler)` removes by identity;
  internal readonly `_handlers` array for the popup's keydown dispatch. (Calibrated:
  modifiers `null` = match any modifier state; `Mod` → Ctrl on the host.)
- `suggest.ts` gains the runtime (one manager per compat context):
  - `class EditorSuggestManager`: ordered registry of EditorSuggest instances
    (`registerEditorSuggest` order, per-plugin disposers).
  - Trigger loop, subscribed in `context.ts` to `document:changed` (active view only —
    same guard as the editor-change wiring): build the Editor shim + TFile from the
    registry; for each suggest in order run `onTrigger(cursor, editor, file)`; first
    non-null wins → `suggest.context = { ...info, editor, file }` → `getSuggestions`
    (await; stale-token guard) → non-empty → popup; empty/null → close.
  - Popup (`compat.css`, `.geode-suggest-popup`): fixed-position at
    `view.coordsAtPos(posToOffset(start))`, below the line (flips above near the bottom);
    items capped at `suggest.limit`; `renderSuggestion(item, itemEl)`; hover selects,
    click → `selectSuggestion(item, evt)` + close; `data-testid="editor-suggest-popup"`,
    items `data-testid="editor-suggest-item"`.
  - Document-capture keydown while open: suggest.scope `_handlers` are consulted FIRST
    (exact modifier-set match; `func(evt, ctx)` returning false → preventDefault +
    stopPropagation — nldates' Shift+Enter path); then ArrowDown/ArrowUp navigate,
    Enter → `selectSuggestion(selected, evt)` + close, Escape → close. Plain typing
    falls through to the editor.
  - Non-public surface nldates needs: every EditorSuggest instance gets
    `this.suggestions = { useSelectedItem(evt) }` → selectSuggestion(current) + close.
  - `PopoverSuggest.open/close` drive the popup; `close()` clears `suggest.context = null`
    and is idempotent. Close on: trigger returning null, selection made, active file/view
    switch (`active-file:changed`), mousedown outside popup + editor, Escape, plugin unload.
  - Deviation (recorded once as a gap note, not per keystroke): onTrigger re-evaluates per
    local doc transaction, not on pure cursor movement.
- `plugin.ts`: `registerEditorSuggest(suggest)` becomes REAL — registers into the manager,
  unload disposer unregisters. Remove its gap reporting.
- `fixture.ts` (browser E2E): a fixture EditorSuggest (trigger phrase `@@`, static
  suggestions, selection replaces the trigger range), a command probing
  `requestUrl("data:application/json,...")` into a status-bar item
  (`data-testid` via existing fixture pattern), and a command rendering
  `"**bold** [[Welcome]] - [ ] task"` through `MarkdownRenderer.render` into a probe
  element (`data-testid="obsfixture-md-render"`).

### Settings: Hotkeys section — `features/settings/SettingsModal.tsx`

- New section `{ id: "hotkeys", label: "Hotkeys", icon: "command" }` (between Plugins and
  About; pick any existing keyboard-ish icon if "command" is absent).
- Filter input (`data-testid="settings-hotkeys-filter"`); rows from
  `commands.list()` + `useStore(commands.revision)`, each row
  (`data-testid="hotkey-row-<id>"`): command name, effective-hotkey chip (or "Not set"),
  customize button (`data-testid="hotkey-edit-<id>"`) entering CAPTURE mode:
  - capture takes the NEXT keydown with a non-modifier key → candidate hotkey string
    (built consistently with `matchHotkey`'s grammar, via `normalizeHotkey`);
    Escape cancels; Backspace/Delete sets the override to null (unbound);
    modifier-only chords are never saved.
  - Conflict check via `findHotkeyConflicts(candidate, id)`: warning inline
    (`data-testid="hotkey-conflict-<id>"`) naming the conflicting command; saving is still
    allowed (Obsidian behavior) — both rows then show a conflict badge.
  - Reset-to-default button when `hasHotkeyOverride(id)` (`data-testid="hotkey-reset-<id>"`).
- `features/palette/CommandPalette.tsx`: hotkey chip reads `getEffectiveHotkey`.

### As-built deltas (post-review, adversarially confirmed — R6)

Review: 5 dimensions, 13 findings confirmed (9 unique root causes), 2 refuted. All fixed:

- **`closeActive()` cancels in-flight `getSuggestions`** (token bump) and clears EVERY
  lingering `suggest.context` — a pending async suggest has a context but no popup yet, so
  closing only the active one let a stale popup open later (Enter would then replaceRange
  stale coordinates — data-safety). Trigger-null / file-switch / Escape / outside-click /
  dispose all route through it. The winner-selection loop closes other suggests by
  context, not just the active one.
- **Suggest popup keydown has a focus guard**: keystrokes whose target is outside the
  editor + popup (palette input, modals) are never consumed — the popup closes instead.
- **`hotkeyFromEvent(e): string | null` lives in `core/commands.ts`** (exported), not in the
  settings UI: single grammar authority. It returns null (capture keeps waiting) for Meta
  combos, modifier-only chords, a literal "+", and **bare printable keys — a binding
  without Ctrl/Alt (function keys exempt) would swallow normal typing**. Shifted
  punctuation is normalized to the physical base char via e.code (capturing Ctrl+Shift+\
  yields "Ctrl+Shift+\", matching the default binding's spelling, so conflict detection
  compares like with like).
- **`handleKeydown` pre-parses effective hotkeys** (cache invalidated on register/
  unregister/override change), rejects `e.metaKey` outright, and **suppresses
  Ctrl/Alt-less bindings while an editable element has focus** (defense for stale
  persisted bare-key overrides). `matchHotkey` also rejects metaKey.
- **`http_request` is `#[tauri::command(async)]`** — a plain sync command runs ON the main
  thread in Tauri 2; a blocking 30s request would stall the event loop and every queued
  vault_* command (the original contract sentence claimed the opposite and was corrected).
  The HTTP method is validated (`is_ascii_alphabetic`) — ureq validates headers but writes
  the method into the request line unchecked (CRLF smuggling).
- `setInstructions` (EditorSuggest + SuggestModal) reports a gap once instead of silently
  no-op'ing (nldates' "Shift: keep text as alias" hint bar is not rendered).
- Refuted (not defects): Backspace-with-modifiers unbinding in capture mode is the
  contract's explicit carve-out; the 10MB body cap mapping to a transport error has no
  reachable trigger in the suite and falls under the declared transport-error bucket.

### Round 6 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/commands.ts, core/markdown.ts (new), core/net.ts (new), features/editor/preview.ts (pipeline move only) |
| compat-suggest | compat/obsidian/{suggest,plugin,context,ui}.ts, compat/obsidian/compat.css |
| compat-net-render | compat/obsidian/{util,index,fixture}.ts |
| shell-settings | features/settings/*, features/palette/CommandPalette.tsx, src-tauri/Cargo.toml, src-tauri/src/main.rs |

Frozen cross-agent surfaces: everything in this section's code blocks. compat-net-render
consumes `core/net.ts` + `core/markdown.ts` exactly as declared; compat-suggest consumes
`document:changed` + the Editor shim as declared; shell-settings consumes the
CommandRegistry additions as declared.

## Round 5 additions — compat T2: moment + registerView real mounting

Calibration source: `.calibration/API-REFERENCE-R5.md` (regenerated 2026-06-10 from official
obsidian.d.ts + suite main.js call-site scans). Implement EXACTLY against it.
Suite facts that drive this contract:
- nldates & calendar consume moment **exclusively via `window.moment`** (zero imports);
  the official module also has `export const moment: typeof Moment` — we provide BOTH.
- calendar uses the LEGACY startup API: `workspace.layoutReady` bool + `on("layout-ready")`
  **event**, then `getRightLeaf(false).setViewState({type})` chained synchronously (non-null!).
- recent-files: `[leaf] = getLeavesOfType(type)`, `getLeftLeaf(!1)`, `await setViewState({type})`,
  `await revealLeaf(leaf)`, `detachLeavesOfType(type)`, `ensureSideLeaf(type,"left",{reveal:true})`
  (onUserEnable), `getLeavesOfType(type).first()` (obsidian's Array.prototype extension!).
- calendar's ItemView subclass touches `this.app` and `this.registerEvent` **inside its
  constructor** — `View`'s constructor must set `app` from the leaf before subclass code runs.

### moment (one-time T2 decision, ROADMAP R5 P0)

- npm dependency `moment@^2.30.1` is added by the chief — implementation agents still must
  NOT add further deps.
- `compat/obsidian/util.ts`: `export const moment` becomes the real moment instance
  (replaces the throwing placeholder; remove the gap plumbing for it).
- Loader sets `window.moment` (idempotent) BEFORE evaluating any plugin main.js, in both
  desktop and browser/fixture paths. Do not overwrite an existing `window.moment`.
- `window._bundledLocaleWeekSpec` writes by calendar are allowed (plain window global, no-op for us).

### Core: `document:changed` event (per-transaction editor signal)

`core/events.ts` EventMap gains:
```ts
/** a LOCAL editor transaction changed a document's text (pre-save, per keystroke) */
"document:changed": { path: string };
```
Emitted from `DocumentHandle.syncExtension` (core/documents.ts) when an update contains a
local (non-sync-annotated) doc change — one emit per update, after forwarding to other views.
NOT emitted for setText/external reload/undo-history moves without doc change.
compat `context.ts` rewires workspace `'editor-change'` to this event (replacing the
file:modified DEVIATION — remove that gap report and the warn in workspace.on).

### Core: plugin sidebar panels (host for compat custom views)

`core/plugins.ts`:
```ts
export interface SidebarPanelContribution {
  id: string;                 // unique, e.g. "obsidian:view:recent-files"
  side: "left" | "right";
  title: string;
  iconSvg?: string;           // raw <svg> markup for the selector button
  el: HTMLElement;            // panel body, owned by the contributor
}
// PluginManager:
addSidebarPanel(p: SidebarPanelContribution): () => void;   // disposer removes it
readonly sidebarPanels: Store<ReadonlyArray<SidebarPanelContribution>>;
```

`core/types.ts`: `LeftPanelKind = "explorer" | "search" | (string & {})` and
`RightPanelKind = "backlinks" | "outline" | (string & {})` — dynamic ids are sidebar panel
ids. `core/workspace.ts` sanitizeState accepts any non-empty string for both fields.
Selecting/falling back is the App shell's job: an unknown id renders the default panel
(explorer / backlinks) WITHOUT mutating state, so a panel that registers later wins again.

App shell (`app/App.tsx`):
- Left side: one ribbon button per left `sidebarPanels` entry (after the built-in buttons,
  before plugin ribbon icons; `data-testid="sidebar-panel-btn-<id>"`), toggling
  `setLeftPanel(p.id)` like the built-ins.
- Right side: one extra tab per right entry in the existing `right-tabs` strip
  (`data-testid="sidebar-panel-tab-<id>"`), switching `setRightPanel(p.id)`.
- Body: when the selected id matches a registered panel, host `p.el` via an element-host
  div (`data-testid="sidebar-panel-<id>"`, same append/remove pattern as PluginElementHost).
- Panel removal while selected: App falls back to the default panel automatically on the
  next render (store update re-renders; no workspace state mutation).

### Compat: real WorkspaceLeaf for sidebar views

`compat/obsidian/workspace.ts` — view registry + two leaf kinds:
- Workspace gains `_viewRegistry: Map<string, { creator: ViewCreator; pluginId: string }>`
  and `_sideLeaves: Set<SidebarViewLeaf>` (internal).
- `Plugin.registerView(type, viewCreator)` (plugin.ts) becomes REAL: registers into the
  active Workspace shim's registry; duplicate type → console.warn + ignore. The plugin's
  unload disposer runs `detachLeavesOfType(type)` then unregisters the creator.
- `class SidebarViewLeaf` implements the WorkspaceLeaf surface (same class hierarchy or
  duck-typed twin of the active-pane facade — implementor's choice; `instanceof
  WorkspaceLeaf` is NOT required by the suite):
  - carries `side: "left" | "right"`, `_app: App` (View constructor reads it), the mounted
    `view: View | null`, panel wrapper el + panel disposer.
  - `async setViewState({ type, active? })`: unknown type → gap report (current behavior);
    known type → tear down any current view, `view = creator(this)`, `view.load()`,
    append `view.containerEl` into a `.geode-compat-view-panel` wrapper,
    `plugins.addSidebarPanel({ id: "obsidian:view:" + type, side, title:
    view.getDisplayText(), iconSvg: getIconSvg(view.getIcon()), el: wrapper })`,
    then `await view.onOpen()` (cast — it is protected), register in `_sideLeaves`.
    `active: true` → reveal (below).
  - `detach()`: fire-and-forget `view.onClose()`, `view.unload()`, panel disposer,
    remove from `_sideLeaves`. Safe to call twice.
  - `getViewState()` → `{ type: view?.getViewType() ?? "empty" }`;
    `getDisplayText()`/`getIcon()` delegate to the view; `openFile` → workspace.openFile.
- Workspace methods (signatures per API-REFERENCE-R5):
  - `getLeftLeaf(split)` / `getRightLeaf(split)` → ALWAYS a fresh non-null SidebarViewLeaf
    (calendar chains `.setViewState` without a null check).
  - `getLeavesOfType(type)` → real array of mounted SidebarViewLeaf matching; built-in
    types ("markdown" etc.) keep returning `[]` (recorded deviation).
  - `revealLeaf(leaf)` → `Promise<void>`: mounted sidebar leaf → `setLeftPanel/'s panel id
    or setRightPanel` (this also opens the sidebar); other leaves → resolved no-op.
  - `detachLeavesOfType(type)` → detach every matching leaf (replaces the warn-stub).
  - `ensureSideLeaf(type, side, opts?: { reveal?: boolean })` → existing leaf or create on
    `side` + `setViewState({type})`; reveal when asked; returns `Promise<WorkspaceLeaf>`.
  - `iterateAllLeaves(cb)` → activeLeaf facade + every mounted side leaf.
  - `splitActiveLeaf(_direction?)` (legacy) → `handle.workspace.splitActivePane("row")` and
    return a fresh active-pane facade; `getUnpinnedLeaf()` (legacy) → active-pane facade.
  - `_flushLayoutReady()` additionally `this.trigger("layout-ready")` AFTER flushing the
    onLayoutReady queue (calendar's legacy startup path).
- `view.ts`: `View` constructor sets `this.app` from the leaf's `_app` when present
  (active-pane facade also carries `_app` now); `onOpen`/`onClose` stay protected.
  Remove the "never mounted this round" comments.

### Compat: misc surface the suite's runtime paths hit

- `dom.ts`: add obsidian's `Array.prototype.first()/last()` augmentation (idempotent,
  non-enumerable) + global `activeDocument`/`activeWindow` (aliases of document/window);
  verify `createDiv("cls-string", cb)` / `createEl(tag, "cls-string")` string-info overload
  works (official DomElementInfo | string).
- `icons.ts`: export `setTooltip(el: HTMLElement, tooltip: string, options?: unknown): void`
  (sets aria-label + title); `getIconSvg` already exists.
- `ui.ts`: export `class Keymap` with static `isModEvent(evt?: UserEvent | null):
  PaneType | boolean` (ctrl/meta → "tab", else false).
- `plugin.ts` App shim getters (warn-stub once + gap report, never crash):
  `dragManager` → `{ dragFile: () => null, onDragStart: () => {} }`;
  `internalPlugins` → `{ getEnabledPluginById: () => null, getPluginById: () => null }`;
  `plugins` → `{ getPlugin: () => null, enabledPlugins: new Set<string>(), plugins: {} }`.
- `vault.ts` shim: `getConfig(key: string): unknown` (non-public API calendar/nldates call):
  `defaultViewMode` → `"source"`, `useMarkdownLinks` → `false`, anything else `undefined`;
  each key reported as gap once.
- `index.ts` re-exports the new names: `Keymap`, `setTooltip` (moment is already exported).
- `fixture.ts`: register a fixture ItemView (`type "fixture-view"`, content carries
  `data-testid="obsfixture-view-body"`), a command `fixture: open view` running the
  recent-files sequence (getLeavesOfType → getRightLeaf(false) → await setViewState →
  await revealLeaf), and a command asserting `window.moment` works
  (`window.moment().format("YYYY-MM-DD")` written into a status bar item).

### As-built deltas (post-review, all adversarially confirmed)

- **`window.app = ctx.app`** is assigned in the loader before any plugin evaluates (both
  suite P0 plugins read `window.app` directly — fixture probes it via
  `data-testid="obsfixture-app-probe"`). `window.moment ??= moment` (typed, no cast).
- moment ships as **`moment/min/moment-with-locales`** (138 locales on ONE instance —
  a separate `moment/min/locales` entry registers against a second copy under Vite's dep
  optimizer); global locale restored to `"en"` after the locale definitions run.
- dom.ts installs the FULL official global block (obsidian.d.ts lines 10-48):
  `Array.prototype.{first,last,contains,remove,shuffle,unique}`, `Array.combine`,
  `Object.{isEmpty,each}`, `Math.{clamp,square}`, `String.{isString}` +
  `String.prototype.{contains,format}`, `Number.isNumber` (recent-files' settings probe
  calls `.contains()` on arrays at redraw time).
- compat `MarkdownView extends FileView` (calendar gates on `view instanceof FileView`).
- `SidebarViewLeaf.setViewState` detaches other leaves of the same type before mounting
  (panel ids are type-keyed) and contains a rejecting `onOpen()` (console.error +
  gap + rollback detach — mirrors detach()'s onClose containment).
- `addSidebarPanel`'s disposer removes by object identity, not id.
- `WorkspaceLeaf.openFile` maps `openState.state?.mode ?? openState.mode`
  ("source"/"preview") onto `setTabMode`; anything else keeps the live default.
- `GeodePlugin.onUserEnable?()` exists on the core interface;
  `PluginManager.enable(id, { userAction: true })` (the SettingsModal toggle) calls it
  after a successful onload — the loader wrapper forwards to the obsidian instance
  (recent-files auto-mounts its view on user enable via `ensureSideLeaf`).
- App shell highlights use the FALLBACK-resolved panel id (stale persisted ids no longer
  produce a zero-selected tablist); `iconSvg` is mounted only when it parses to a single
  `<svg>` root. SettingsModal no longer imports `@compat` — `obsidianLoadReport` is
  forwarded through the app context (`app.obsidianLoadReport`, wired in main.tsx).

### Round 5 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/events.ts, core/documents.ts, core/plugins.ts, core/types.ts, core/workspace.ts |
| compat-views | compat/obsidian/{workspace,view,plugin,loader,context}.ts |
| compat-misc | compat/obsidian/{dom,icons,ui,util,vault,index,fixture,gaps}.ts, global.d.ts, compat.css |
| shell | app/App.tsx, styles/app.css |

## Round 4 additions — Obsidian compat T0+T1 + shared document model

### Shared document model — `core/documents.ts`

One `DocumentHandle` per open file replaces per-EditorPane text/dirty/save state.
Fixes (R3 debt): double-dirty last-writer-wins across panes; rename rebuilding the
CM view (undo/cursor/scroll loss). Also the foundation for the compat `Editor` shim.

```ts
class DocumentManager {
  constructor(vault: Vault, events: EventBus);
  /** Load (or share) the document for a vault path. Refcounted: pair with release(). */
  acquire(path: string): Promise<DocumentHandle>;
  /** The live handle for a path, if any (sync). */
  get(path: string): DocumentHandle | null;
  /** Editor panes report the focused CM view (active markdown tab). */
  setActiveView(view: EditorView | null, path: string | null): void;
  /** The focused editor view — consumed by the compat Editor shim. */
  getActiveView(): { view: EditorView; path: string } | null;
  /** Flush every dirty document (main.tsx registers this as a workspace flusher). */
  flushAll(): Promise<void>;
}
class DocumentHandle {
  readonly path: string;          // live — retargeted in place on rename
  readonly dirty: boolean;
  getText(): string;
  /** Build a per-view EditorState seeded with the shared doc + sync glue. */
  createViewState(extensions: Extension[]): EditorState;
  /** Attach a view created from createViewState(); returns a disposer. */
  attachView(view: EditorView): () => void;
  /** Programmatic full replace (external reload / plugin writes). Does NOT mark dirty. */
  setText(text: string): void;
  flush(): Promise<void>;
  release(): void;
}
```

Behavior contract (the data-safety rules move from EditorPane into the handle):
- ONE dirty flag + ONE debounced auto-save (600ms) per file, no matter how many panes.
- All attached views stay byte-identical at all times; undo in any view never desyncs.
- Save failure restores `dirty` unless newer content is pending (retry on next flush).
- `file:renamed` retargets `path` in place — attached views are NOT rebuilt.
- `file:deleted` cancels pending saves; a deleted file is never resurrected.
- `file:external-modified` / `file:modified` → reload only when clean (in-flight save
  counts as dirty; re-check after the async read; content-equality no-op).
- EditorPane keeps per-view mode/selection/scroll; acquires on mount, releases on unmount.

### Vault adapter additions (Obsidian plugin discovery + config IO)

```ts
interface ObsidianPluginSource {
  dir: string;                    // folder name under .obsidian/plugins
  manifestJson: string;
  mainJs: string;
  stylesCss: string | null;
  dataJson: string | null;
}
// VaultAdapter:
listObsidianPlugins(): Promise<ObsidianPluginSource[]>;
/** Read a file under <vault>/.obsidian/ (e.g. "community-plugins.json",
    "plugins/<id>/data.json"). Returns null when missing. */
readConfig(relPath: string): Promise<string | null>;
/** Write under <vault>/.obsidian/, creating parent dirs. */
writeConfig(relPath: string, content: string): Promise<void>;
```

Rust commands (serde camelCase): `vault_obsidian_plugins(vault) -> Vec<ObsidianPluginSource>`,
`vault_read_config(vault, path) -> Option<String>`, `vault_write_config(vault, path, content)`.
Both config commands safe_join under `<vault>/.obsidian` only. Memory adapter: configs in an
in-session Map; `listObsidianPlugins()` returns `window.__geodeObsidianPlugins ?? []` (E2E injection).

### PluginManager extensions

```ts
type PluginSource = "builtin" | "external" | "obsidian";
register(plugin, source?, opts?: {
  enabled?: boolean;                          // overrides the localStorage enabled-set
  persistEnabled?: (enabled: boolean) => void; // replaces localStorage persistence for this record
}): Promise<void>;
unregister(id: string): void;                 // teardown without persisting enabled:false
// Element-based UI contributions (App shell hosts the elements):
addStatusBarElement(id: string, el: HTMLElement): () => void;
readonly statusBarElements: Store<ReadonlyArray<{ id: string; el: HTMLElement }>>;
addRibbonElement(id: string, el: HTMLElement): () => void;   // el carries its own click handler
readonly ribbonItems: Store<ReadonlyArray<{ id: string; el: HTMLElement }>>;
// Plugin settings sections (SettingsModal renders mount/unmount into a host div):
interface PluginSettingsSection { id: string; pluginId: string; name: string;
  mount(container: HTMLElement): void; unmount(): void; }
addSettingsSection(s: PluginSettingsSection): () => void;
readonly settingsSections: Store<ReadonlyArray<PluginSettingsSection>>;
```

### Command availability

`Command.available?: () => boolean` — palette hides and hotkeys skip commands whose
`available()` returns false (used by compat editorCallback variants).

### Compat layer — `src/compat/obsidian/`

`loadObsidianPlugins(app: Omit<AppHandle, "ui"> & { plugins: PluginManager }, vault: Vault): Promise<void>` (from `@compat/obsidian/loader`)
is idempotent like `loadExternal`: unloads previously loaded obsidian records first.
Calibrated signatures live in `.calibration/API-REFERENCE.md` (regenerate per
docs/OBSIDIAN-COMPAT.md); implement EXACTLY against it, never from memory.
Internal layout is the implementor's choice within `src/compat/`; fixed points:
- `index.ts` exports the full `require("obsidian")` module surface.
- `loader.ts`: discover → validate manifest (missing id/name/version rejects; other gaps warn;
  minAppVersion > apiVersion warns, never blocks) → evaluate main.js as CommonJS
  (`exports.default ?? module.exports`, must be a constructor) → `new Ctor(appShim, manifest)`
  → wrap as a GeodePlugin record `register(wrapper, "obsidian", { enabled, persistEnabled })`.
  Enabled state mirrors `.obsidian/community-plugins.json` (flat id array; preserve unknown ids
  on write). styles.css injected per plugin on enable, removed on disable.
- require map: `obsidian` → shim; `@codemirror/state|view|language|commands|search|autocomplete`,
  `@lezer/highlight` → the HOST instances (instanceof must work); anything else throws a clear
  error which the loader records as that plugin's failure reason (shown in settings).
- `dom.ts`: global prototype augmentation (createEl & friends) applied idempotently before any
  plugin code runs. Only compat may USE these helpers even though types are global.
- TFile/TFolder identity: ONE canonical instance per path, registry synced from vault events;
  rename mutates the instance and fires per-descendant rename(oldPath). Shim exports the real
  constructors (plugins use `instanceof TFile`).
- `apiVersion = "1.5.0"`; `requireApiVersion` does a semver compare against it.
- Suite-driven minimal `Editor` subset (T1.5) over `documents.getActiveView()`:
  getValue/setValue/getSelection/somethingSelected/replaceSelection/getCursor/setCursor/
  setSelection/replaceRange/getLine/lineCount/lastLine/getRange/posToOffset/offsetToPos/
  focus/hasFocus. editorCallback/editorCheckCallback map to Command.available.
- Out-of-tier APIs (registerView, MarkdownRenderer, moment, …) are warn-stubs: console.warn
  once + recorded in the loader's gap report, never a crash. Browser fixture: `?obsfixture=1`
  makes the loader register the built-in test plugin from `compat/obsidian/fixture.ts`.

### Bootstrap wiring (main.tsx / App.tsx)

`DocumentManager` is created in bootstrap and exposed as `app.documents` (AppHandle + GeodeApp);
its `flushAll` is registered as a workspace flusher. After `plugins.loadExternal(vault)` the shell
calls `loadObsidianPlugins(app, vault)`; the reload-plugins command re-runs both.

## Round 3 additions

- **Pane tree** replaces the flat tab list. `WorkspaceState.root: PaneNode` + `activePaneId`;
  `PaneNode = PaneLeaf { id, tabs, activeTabId } | PaneSplit { id, direction: "row"|"column", children, sizes }`.
  Persisted v1 states (flat `tabs`) migrate automatically to a single leaf.
- Tab-level Workspace methods (`openFile`, `closeTab`, `setActiveTab`, `setTabMode`, the toggles)
  keep their signatures and target the **active pane**; `openFile` additionally accepts `{ paneId }`.
- New pane methods: `setActivePane(id)`, `splitActivePane(direction)` (duplicates the active tab,
  Obsidian-style), `moveTab(tabId, targetPaneId, index?)`, `moveTabToEdge(tabId, targetPaneId, edge)`,
  `setSplitSizes(splitId, sizes)`, `focusAdjacentPane(±1)`, `getActivePane()`, `getPanes()`.
- Pure helpers exported from `@core/workspace`: `flattenLeaves`, `findLeaf`, `findTabLeaf`,
  `allTabs(root)`, `findActiveTab(state)` — features derive "the active tab" via `findActiveTab`,
  never by scanning a tabs array.
- Tree invariants (enforced by `normalize`): empty leaves collapse (except a lone root leaf),
  single-child splits unwrap, same-direction nested splits merge, `sizes` stay normalized with
  a 0.12 minimum fraction.
- Commands: `app:split-right` (Ctrl+\), `app:split-down` (Ctrl+Shift+\),
  `app:focus-next-pane` / `app:focus-previous-pane` (Ctrl+Alt+←/→).
- The same file may be open in several panes at once; editors reconcile via `file:modified`
  (reload only when not dirty and content actually differs — same rule as external changes).

## Round 2 additions

- `ViewMode` is now `"live" | "source" | "preview"` ("live" = Obsidian-style live preview, the default; old persisted "edit" migrates to "live"). `workspace.toggleActiveTabMode()` toggles live↔preview (Ctrl+E); `workspace.toggleActiveSourceMode()` toggles live↔source (Ctrl+Shift+E).
- Right sidebar is tabbed: `WorkspaceState.rightPanel: "backlinks" | "outline"`, switched via `workspace.setRightPanel()`. New component contract: `features/outline/OutlinePanel.tsx` exports `OutlinePanel` (no props).
- Sidebars are resizable: `leftWidth`/`rightWidth` in state, `workspace.setSidebarWidth(side, px)`.
- File watching: `VaultAdapter.startWatch(onChange)` — Tauri impl listens to the backend event `vault:fs-change` (Vec<String> of vault-relative changed paths) and the Rust command `vault_watch(vault)` starts/replaces a debounced recursive watcher. `Vault.load()` wires this automatically and emits: `file:external-modified` (open files decide whether to reload — reload ONLY if not dirty), `file:created`/`file:deleted`, `vault:external-changed`.
- Frontmatter: `parseNote` extracts a leading YAML block into `NoteMetadata.frontmatter` (`fields`, `from`, `to`), plus `aliases` (which now participate in `resolveLink`) and frontmatter tags (merged into `tags`). Editors should render/hide the frontmatter region based on `parseFrontmatter(content)` from `@core/metadata`.
- External plugins: `VaultAdapter.listPluginFiles()` returns `{name, content}` for `<vault>/.geode/plugins/*.js`; `PluginManager.loadExternal(vault)` evaluates and registers them (idempotent: unloads previously loaded external plugins first). Rust command: `vault_plugin_files(vault)`.

## Verification every agent must run before finishing

```
npx tsc --noEmit     # must pass with zero errors
```
Do not edit files outside your assigned folder(s). Do not add npm dependencies.
Already available deps: @codemirror/* (state, view, commands, language, lang-markdown,
language-data, autocomplete, search), @lezer/highlight, markdown-it, d3-force, @tauri-apps/api & plugin-dialog.
