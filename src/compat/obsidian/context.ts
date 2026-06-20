/**
 * CompatContext — one per loader run. Builds the shim instances (App / Vault /
 * Workspace / MetadataCache + the canonical TFile registry) and wires Geode
 * events into the obsidian event surface. dispose() detaches everything so a
 * reload starts clean.
 *
 * Event mapping (documented deviations are recorded as gaps by the loader):
 *  - file:created/deleted/renamed/modified  -> vault 'create'/'delete'/'rename'/'modify'
 *  - metadata:updated                       -> metadataCache 'changed'/'resolve'/'resolved'
 *  - active-file:changed                    -> workspace 'active-leaf-change' + 'file-open'
 *  - document:changed (active editor)       -> workspace 'editor-change'
 *                                              + EditorSuggest trigger loop (R6)
 *  - document:selection-changed (active)    -> EditorSuggest trigger loop (R9 —
 *                                              onTrigger re-evaluates on pure
 *                                              cursor movement, official cadence)
 *  - workspace root identity change         -> workspace 'layout-change'
 *
 * Startup semantics (CREATE-ON-LOAD, API-REFERENCE area 2/3):
 *  - vault 'create' is replayed by the LOADER for every indexed file after
 *    the plugin loop, mirroring Obsidian's startup; Workspace.onLayoutReady
 *    callbacks queue during plugin load and flush AFTER the replay (the
 *    documented opt-out).
 *  - metadataCache 'resolved' is fired once by the loader when the initial
 *    vault-wide index already finished before plugin load; afterwards it
 *    fires on every metadata:updated batch (below).
 */
import type { AppHandle, PluginManager } from "@core/plugins";
import type { Vault as GeodeVault } from "@core/vault";
import { registerEditorExtension as registerCoreEditorExtension } from "@core/editorExtensions";
import { editorContextMenuExtension } from "./editorMenu";
import { FileRegistry } from "./files";
import { CollectorMenu } from "./menuCollect";
import { MetadataCache } from "./metadata";
import { App } from "./plugin";
import { EditorSuggestManager } from "./suggest";
import { _setCompatHostHandle } from "./util";
import { Vault } from "./vault";
import { makeActiveMarkdownView, Workspace } from "./workspace";

export interface CompatContext {
  app: App;
  vault: Vault;
  workspace: Workspace;
  metadataCache: MetadataCache;
  registry: FileRegistry;
  dispose(): void;
}

const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith(".md");

export function createCompatContext(
  handle: Omit<AppHandle, "ui">,
  plugins: PluginManager,
  geodeVault: GeodeVault,
): CompatContext {
  const registry = new FileRegistry();
  const vault = new Vault(geodeVault, registry);
  registry.attach(vault);
  registry.rebuildFromVault(geodeVault);
  const metadataCache = new MetadataCache(handle, registry);
  const workspace = new Workspace(handle, registry);
  const app = new App({ handle, plugins, registry }, vault, workspace, metadataCache);
  // the workspace shim (and its leaves) need the App bridge for view mounting
  workspace._setApp(app);
  // EditorSuggest runtime (R6) — registerEditorSuggest reaches it via the App
  const suggests = new EditorSuggestManager();
  app._suggests = suggests;
  // module-level APIs (MarkdownRenderer.render) resolve links/open files
  // through the CURRENT context's handle; cleared again in dispose
  _setCompatHostHandle(handle);

  const disposers: Array<() => void> = [];
  const ev = handle.events;

  /* ----- registry / vault events ----- */
  const pendingChanged = new Set<string>();

  disposers.push(
    ev.on("file:created", ({ path }) => {
      registry.handleCreated(path);
      if (isMarkdown(path)) {
        pendingChanged.add(path);
        // a new basename can resolve other files' unresolved links
        metadataCache._invalidateLinkTables();
      }
    }),
  );

  disposers.push(
    ev.on("file:deleted", ({ path }) => {
      const file = registry.getFile(path);
      const prevCache = file ? metadataCache.getCache(path) : null;
      registry.handleDeleted(path);
      metadataCache._invalidateLinkTables();
      if (file) metadataCache.trigger("deleted", file, prevCache);
    }),
  );

  disposers.push(
    ev.on("file:renamed", ({ oldPath, newPath }) => {
      registry.handleRenamed(oldPath, newPath);
      metadataCache._invalidateLinkTables();
    }),
  );

  disposers.push(
    ev.on("file:modified", ({ path }) => {
      registry.handleModified(path);
      if (isMarkdown(path)) {
        pendingChanged.add(path);
        metadataCache._markLinkSourceDirty(path);
      }
    }),
  );

  // per-transaction editor signal (R5): only the active document fires
  // 'editor-change', matching obsidian's focused-editor semantics. The same
  // transaction drives the EditorSuggest trigger loop (R6).
  disposers.push(
    ev.on("document:changed", ({ path }) => {
      const active = handle.documents.getActiveView();
      if (active && active.path === path) {
        const view = makeActiveMarkdownView(handle, registry);
        if (view) {
          workspace.trigger("editor-change", view.editor, view);
          void suggests.runTrigger(view.editor, view.file);
        }
      }
    }),
  );

  // pure cursor movement (R9): same active-view guard as document:changed,
  // same trigger loop (first non-null onTrigger wins; all null -> closeActive)
  // — but NO 'editor-change' (the document did not change). Edits made inside
  // the loop fire document:changed synchronously; the manager's stale-token
  // guard keeps the nested run authoritative, so there is no recursion.
  disposers.push(
    ev.on("document:selection-changed", ({ path }) => {
      const active = handle.documents.getActiveView();
      if (active && active.path === path) {
        const view = makeActiveMarkdownView(handle, registry);
        if (view) void suggests.runTrigger(view.editor, view.file);
      }
    }),
  );

  let lastTree = geodeVault.tree.get();
  disposers.push(
    ev.on("vault:changed", ({ reason }) => {
      const tree = geodeVault.tree.get();
      if (reason === "load") {
        registry.rebuildFromVault(geodeVault);
        metadataCache._invalidateLinkTables();
        lastTree = tree;
        return;
      }
      // internal modify() never rebuilds the tree (same root object identity);
      // every path that can add folders goes through refreshTree and produces
      // a fresh root — skip the O(tree) walk on each debounced save
      if (tree !== lastTree) {
        lastTree = tree;
        registry.reconcileFolders(tree);
      }
    }),
  );

  /* ----- metadata events ----- */
  disposers.push(
    ev.on("metadata:updated", () => {
      const paths = [...pendingChanged];
      pendingChanged.clear();
      for (const path of paths) {
        const file = registry.getFile(path);
        if (!file) continue;
        const cache = metadataCache.getCache(path);
        if (!cache) continue;
        const data = geodeVault.readCached(path) ?? "";
        metadataCache.trigger("changed", file, data, cache);
        metadataCache.trigger("resolve", file);
      }
      metadataCache.trigger("resolved");
    }),
  );

  /* ----- workspace events ----- */
  disposers.push(
    ev.on("active-file:changed", ({ path }) => {
      if (path) workspace._lastFilePath = path;
      // switching the active file/view closes any open editor-suggest popup
      suggests.closeActive();
      workspace.trigger("active-leaf-change", workspace.activeLeaf);
      workspace.trigger("file-open", path ? registry.getFile(path) : null);
    }),
  );

  let prevRoot = handle.workspace.state.get().root;
  disposers.push(
    handle.workspace.state.subscribe(() => {
      const root = handle.workspace.state.get().root;
      if (root !== prevRoot) {
        prevRoot = root;
        workspace.trigger("layout-change");
      }
    }),
  );

  /* ----- R130: file-menu contribution bridge -----
   * Compat registers ONE provider into the core PluginManager; the Explorer (a feature, which
   * cannot import compat) calls plugins.collectFileMenu(ctx) while opening its context menu. The
   * provider builds a CollectorMenu (records plugin items as plain data, no DOM), fires the
   * 'file-menu' workspace event so every plugin handler contributes, and returns the items. */
  disposers.push(
    plugins.registerFileMenuProvider((ctx) => {
      const file = ctx.isFolder ? registry.getFolder(ctx.path) : registry.getFile(ctx.path);
      if (!file) return [];
      const menu = new CollectorMenu();
      workspace.trigger("file-menu", menu, file, ctx.source, undefined);
      return menu.items;
    }),
  );

  /* ----- R139: files-menu — the MULTI-file analogue. Right-clicking a multi-selection fires
   * Obsidian's 'files-menu' with a TAbstractFile[]. Mirrors the file-menu bridge (CollectorMenu +
   * trigger); paths resolve to folders-or-files for mixed selections. ----- */
  disposers.push(
    plugins.registerFilesMenuProvider((ctx) => {
      const files = ctx.paths
        .map((p) => registry.getFolder(p) ?? registry.getFile(p))
        .filter((f): f is NonNullable<typeof f> => f !== null);
      if (files.length === 0) return [];
      const menu = new CollectorMenu();
      workspace.trigger("files-menu", menu, files, ctx.source, undefined);
      return menu.items;
    }),
  );

  /* ----- R131: editor-menu — an always-on CM contextmenu extension (via the R115 core registry)
   * turns an editor right-click into the 'editor-menu' event + shows the plugin items. Compat-only:
   * the editor feature applies it without importing compat. ----- */
  disposers.push(registerCoreEditorExtension(editorContextMenuExtension(workspace)));

  return {
    app,
    vault,
    workspace,
    metadataCache,
    registry,
    dispose() {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch (err) {
          console.error("[obsidian-compat] context disposer threw", err);
        }
      }
      suggests.dispose();
      _setCompatHostHandle(null);
    },
  };
}
