# Geode Architecture Contract

Geode is an Obsidian-style local-first markdown knowledge base.
Stack: **Tauri 2 (Rust shell) + React 18 + TypeScript (strict) + Vite + CodeMirror 6**.

## Layering — who may import what

```
src/core/      pure TS, NO React components (only hooks in store.ts). Never imports features/app.
src/app/       shell: App.tsx layout, AppContext, icons. Imports core + feature entry components.
src/features/  one folder per feature. Imports core + app/AppContext + app/icons ONLY.
               NEVER import from another feature folder.
src/plugins/   built-in plugins (GeodePlugin[]). Imports core only.
```

Path aliases: `@core/*`, `@features/*`, `@app/*` (see tsconfig).

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

## Round 3 additions (current)

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
