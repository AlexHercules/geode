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
 *  - file:modified (active editor)          -> workspace 'editor-change'  [DEVIATION]
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
import { FileRegistry } from "./files";
import { MetadataCache } from "./metadata";
import { App } from "./plugin";
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
      // DEVIATION: obsidian fires 'editor-change' per editor transaction;
      // Geode surfaces saved modifications of the focused document instead.
      const active = handle.documents.getActiveView();
      if (active && active.path === path) {
        const view = makeActiveMarkdownView(handle, registry);
        if (view) workspace.trigger("editor-change", view.editor, view);
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
    },
  };
}
