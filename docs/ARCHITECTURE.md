# Geode Architecture Contract

Geode is an Obsidian-style local-first markdown knowledge base.
Stack: **Tauri 2 (Rust shell) + React 18 + TypeScript (strict) + Vite + CodeMirror 6**.

## Layering — who may import what

```
src/core/      pure TS, NO React components (only hooks in store.ts). Never imports features/app.
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

## Round 5 additions (current) — compat T2: moment + registerView real mounting

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
