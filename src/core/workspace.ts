import type {
  LeftPanelKind,
  ModalKind,
  PaneLeaf,
  PaneNode,
  PaneSplit,
  RightPanelKind,
  SplitDirection,
  TabState,
  ThemeKind,
  ViewMode,
  WorkspaceState,
} from "./types";
import { EventBus } from "./events";
import { Store } from "./store";
import { defaultNewTabMode } from "./appearance";
import { basename, stripExtension } from "./vault";
import { isAttachmentPath } from "./attachments";

const PERSIST_KEY = "geode.workspace.v1";
const RECENTLY_CLOSED_MAX = 20;
const NAV_HISTORY_MAX = 50;

/** R79: resolve a theme kind to the concrete value written to `dataset.theme`.
 *  "system" follows the OS color scheme; "dark"/"light" map to themselves.
 *  Pure — exported for the desktop probe truth-table. */
export function resolveTheme(kind: ThemeKind, systemPrefersDark: boolean): "dark" | "light" {
  if (kind === "system") return systemPrefersDark ? "dark" : "light";
  return kind;
}

/** Current OS color-scheme preference; true (dark) where matchMedia is absent. */
function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

/** R81: which tab ids a "close others / right / all" action removes — pinned tabs
 *  are always kept (Obsidian behaviour). Pure — exported for the desktop probe. */
export function tabIdsToClose(
  tabs: readonly { id: string; pinned?: boolean }[],
  targetId: string,
  mode: "others" | "right" | "all",
): string[] {
  const idx = tabs.findIndex((t) => t.id === targetId);
  const out: string[] = [];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (tab.pinned) continue;
    if (mode === "all" || (mode === "others" && tab.id !== targetId) || (mode === "right" && idx >= 0 && i > idx)) {
      out.push(tab.id);
    }
  }
  return out;
}

/** R37: one entry in a tab's back/forward navigation history. */
interface NavLocation {
  filePath: string;
  mode: ViewMode;
}
interface NavHistory {
  back: NavLocation[];
  forward: NavLocation[];
}

/** A user-closed tab, captured for reopen (Mod+Shift+T). Session-only. */
interface ClosedTab {
  viewType: "markdown" | "graph" | "attachment";
  filePath: string | null;
  mode: ViewMode;
  /** the pane it was closed from — reopen prefers it if it still exists */
  paneId: string;
  /** R39: restore pin state on reopen (Obsidian restores a reopened tab's pin). */
  pinned?: boolean;
}
let tabCounter = 0;
let paneCounter = 0;
const newTabId = () => `tab-${++tabCounter}-${Math.random().toString(36).slice(2, 7)}`;
const newPaneId = () => `pane-${++paneCounter}-${Math.random().toString(36).slice(2, 7)}`;

const MIN_SIDEBAR_W = 170;
const MAX_SIDEBAR_W = 560;

/** synthetic ?bench=N vault sessions are ephemeral — same check as MemoryVaultAdapter */
function isBenchSession(): boolean {
  try {
    return typeof location !== "undefined" && /[?&]bench=\d/.test(location.search);
  } catch {
    return false;
  }
}
/** a split child can't be dragged below this fraction of its parent */
export const MIN_PANE_FRACTION = 0.12;

/* ================= pane tree helpers (pure, exported for UI/features) ================= */

export function makeLeaf(tabs: TabState[] = [], activeTabId: string | null = null): PaneLeaf {
  return { kind: "leaf", id: newPaneId(), tabs, activeTabId };
}

/** All leaves in layout order (depth-first). */
export function flattenLeaves(node: PaneNode): PaneLeaf[] {
  if (node.kind === "leaf") return [node];
  return node.children.flatMap(flattenLeaves);
}

export function findLeaf(node: PaneNode, paneId: string): PaneLeaf | null {
  return flattenLeaves(node).find((l) => l.id === paneId) ?? null;
}

/** The leaf that holds a given tab, or null. */
export function findTabLeaf(node: PaneNode, tabId: string): PaneLeaf | null {
  return flattenLeaves(node).find((l) => l.tabs.some((t) => t.id === tabId)) ?? null;
}

/** Every tab across all panes, in layout order. */
export function allTabs(node: PaneNode): TabState[] {
  return flattenLeaves(node).flatMap((l) => l.tabs);
}

/** The focused leaf's active tab — the single most common selector. */
export function findActiveTab(state: WorkspaceState): TabState | null {
  const leaf = findLeaf(state.root, state.activePaneId) ?? flattenLeaves(state.root)[0];
  if (!leaf) return null;
  return leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? null;
}

/** Replace one leaf in the tree (identity-preserving elsewhere). */
function mapLeaf(node: PaneNode, paneId: string, fn: (leaf: PaneLeaf) => PaneNode): PaneNode {
  if (node.kind === "leaf") return node.id === paneId ? fn(node) : node;
  let changed = false;
  const children = node.children.map((c) => {
    const next = mapLeaf(c, paneId, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/** Apply fn to every leaf (used for rename/delete fixups). */
function mapAllLeaves(node: PaneNode, fn: (leaf: PaneLeaf) => PaneLeaf): PaneNode {
  if (node.kind === "leaf") {
    const next = fn(node);
    return next === node ? node : next;
  }
  let changed = false;
  const children = node.children.map((c) => {
    const next = mapAllLeaves(c, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/** R102: the file-backed viewType for a path — non-md attachments open the read-only
 *  viewer, everything else the editable markdown editor. Derived from the path at EVERY
 *  point a file-backed tab is created/retargeted (openFile / sanitizeTab / rename), so a
 *  binary can never reach the editable/autosave path through a stale or persisted type. */
function fileViewType(path: string): "markdown" | "attachment" {
  return isAttachmentPath(path) ? "attachment" : "markdown";
}

/** R102: retarget a file-backed tab to a new path, RE-deriving viewType (a cross-type
 *  rename must flip editable↔read-only) and title. */
function retargetFileTab(t: TabState, newPath: string): TabState {
  return { ...t, viewType: fileViewType(newPath), filePath: newPath, title: stripExtension(basename(newPath)) };
}

/**
 * Normalize a tree: drop empty leaves (unless it's the only leaf), collapse
 * single-child splits, merge nested same-direction splits, renormalize sizes.
 * Never returns a tree without at least one leaf.
 */
function normalize(node: PaneNode): PaneNode {
  // a lone root leaf may stay empty (the "no file open" state)
  if (node.kind === "leaf") return node;
  const result = normalizeInner(node);
  return result ?? makeLeaf();
}

function normalizeInner(node: PaneNode): PaneNode | null {
  if (node.kind === "leaf") {
    return node.tabs.length > 0 ? node : null;
  }
  const kept: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const n = normalizeInner(c);
    if (!n) return;
    // merge same-direction nested splits into this level
    if (n.kind === "split" && n.direction === node.direction) {
      const share = node.sizes[i] ?? 1 / node.children.length;
      n.children.forEach((gc, j) => {
        kept.push(gc);
        sizes.push(share * (n.sizes[j] ?? 1 / n.children.length));
      });
    } else {
      kept.push(n);
      sizes.push(node.sizes[i] ?? 1 / node.children.length);
    }
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0];
  return { ...node, children: kept, sizes: normalizeSizes(sizes) };
}

/* ================= defaults ================= */

function defaultState(): WorkspaceState {
  const root = makeLeaf();
  return {
    root,
    activePaneId: root.id,
    leftPanel: "explorer",
    rightPanel: "backlinks",
    leftSidebarOpen: true,
    rightSidebarOpen: true,
    leftWidth: 270,
    rightWidth: 290,
    modal: null,
    theme: "dark",
    fontSize: 16,
  };
}

/**
 * Workspace — pane tree of tab groups, sidebars, modals, theme. Persisted to
 * localStorage. Tab-level operations target the ACTIVE pane unless a paneId is
 * given. All mutations go through methods so persistence + events stay consistent.
 */
export class Workspace {
  readonly state = new Store<WorkspaceState>(defaultState());
  /** Most recent NON-NULL active file (survives switching to the graph tab / modals).
   *  Session-only — not persisted. Seeded from the active tab on load. */
  readonly lastActiveFile = new Store<string | null>(null);
  /** One-shot reveal request (R14): EditorPane consumes it (scroll + flash)
   *  then clears it back to null. Session-only — not persisted. Set AFTER
   *  openFile so the consuming pane already targets `path`. */
  readonly revealTarget = new Store<{ path: string; from: number; to: number } | null>(null);
  /** R180 (G4-b): one-shot "reveal file in the explorer tree" request — the
   *  "Reveal active file in navigation" command sets it; the Explorer consumes it
   *  (expand ancestors + select + scroll into view) then clears. Session-only. */
  readonly revealInExplorer = new Store<string | null>(null);
  /** R184 (G3 ui-only→done): one-shot "run a file op on the active file" request —
   *  the file-op commands (duplicate/rename/move/new-folder) set it; the Explorer
   *  consumes it by routing to its existing vetted handlers (makeCopy/startRename/
   *  setMovePath/newFolder) then clears. `path` is null for new-folder. Session-only. */
  readonly explorerFileAction = new Store<
    { action: "duplicate" | "rename" | "move" | "new-folder"; path: string | null } | null
  >(null);
  /** R41: one-shot search request — the Tags pane (or any caller) seeds a query
   *  and opens the search panel; SearchPanel consumes it then clears. Session-only. */
  readonly searchRequest = new Store<string | null>(null);
  private flushers = new Set<() => void | Promise<void>>();
  /** Most-recent-LAST stack of user-closed tabs for Mod+Shift+T. Session-only —
   *  NOT persisted (avoids stale-path risk across restart). Only closeTab feeds
   *  it; reactive cleanups (delete/rename/missing) purge it. */
  private recentlyClosed: ClosedTab[] = [];
  /** Per-tab back/forward navigation history (R37), keyed by TabState.id.
   *  Session-only (NOT persisted — same stale-path reasoning as recentlyClosed).
   *  Every mutation coincides with a workspace.state change, so canTabNavigate*
   *  read fresh under useStore(state) without a dedicated Store. */
  private tabHistory = new Map<string, NavHistory>();

  constructor(private events: EventBus) {
    this.restore();
    this.lastActiveFile.set(this.getActiveFile());
    // when a file is deleted/renamed, fix tabs that point at it
    events.on("file:deleted", ({ path }) => this.handleDeleted(path));
    events.on("file:renamed", ({ oldPath, newPath }) => this.handleRenamed(oldPath, newPath));
    // a vault switch (reason "load") invalidates every old-vault relative path —
    // drop the reopen stack so Mod+Shift+T can't resurrect a SAME-NAMED file in
    // the new vault (closeMissingFileTabs' exists() guard would let such a stale
    // entry survive). Mirrors openVaultFlow's lastActiveFile reset + Document
    // manager's handle invalidation on the same event. (R36 review fix.)
    events.on("vault:changed", ({ reason }) => {
      if (reason === "load") {
        this.recentlyClosed = [];
        this.tabHistory.clear();
      }
    });
  }

  /* ---------- selectors ---------- */

  getActivePane(): PaneLeaf {
    const s = this.state.get();
    return findLeaf(s.root, s.activePaneId) ?? flattenLeaves(s.root)[0];
  }

  getActiveTab(): TabState | null {
    return findActiveTab(this.state.get());
  }

  getActiveFile(): string | null {
    const tab = this.getActiveTab();
    return tab?.viewType === "markdown" ? tab.filePath : null;
  }

  getPanes(): PaneLeaf[] {
    return flattenLeaves(this.state.get().root);
  }

  /* ---------- tab management (active pane unless stated) ---------- */

  /** Open a file in a pane (default: active pane). Reuses that pane's tab for the same file unless newTab. */
  openFile(path: string, opts: { newTab?: boolean; paneId?: string } = {}) {
    const s0 = this.state.get();
    const targetPaneId = opts.paneId ? paneId0(s0, opts.paneId) : s0.activePaneId;
    this.recordNavigation(s0, targetPaneId, path, opts.newTab ?? false);
    this.update((s) => {
      const paneId = opts.paneId ? paneId0(s, opts.paneId) : s.activePaneId;
      const target = findLeaf(s.root, paneId) ?? flattenLeaves(s.root)[0];
      let root = s.root;

      // R102: route non-md attachments to the read-only viewer (viewType "attachment").
      const vt = fileViewType(path);
      const existing = target.tabs.find((t) => t.viewType === vt && t.filePath === path);
      if (existing && !opts.newTab) {
        root = mapLeaf(root, target.id, (l) => ({ ...l, activeTabId: existing.id }));
        return { ...s, root, activePaneId: target.id, modal: null };
      }
      const active = target.tabs.find((t) => t.id === target.activeTabId);
      // replace the active markdown tab's content (Obsidian default behaviour) —
      // UNLESS it is pinned (R39): a pinned tab is never replaced, so fall through
      // to the new-tab branch (open the file in a fresh tab). R102: only markdown→markdown
      // replaces in place; attachments always open in a fresh tab (they don't participate
      // in nav history / mode — like graph), so a binary never overwrites an editable tab.
      if (active && active.viewType === "markdown" && vt === "markdown" && !opts.newTab && !active.pinned) {
        root = mapLeaf(root, target.id, (l) => ({
          ...l,
          tabs: l.tabs.map((t) =>
            t.id === active.id ? { ...t, filePath: path, title: stripExtension(basename(path)) } : t,
          ),
        }));
        return { ...s, root, activePaneId: target.id, modal: null };
      }
      const tab: TabState = {
        id: newTabId(),
        viewType: vt,
        filePath: path,
        // R88: new tabs open in the user's default mode (Obsidian's "Default view
        // for new tabs" + "Default editing mode"); default "live" = prior behaviour
        mode: defaultNewTabMode.get(),
        title: stripExtension(basename(path)),
      };
      root = mapLeaf(root, target.id, (l) => ({ ...l, tabs: [...l.tabs, tab], activeTabId: tab.id }));
      return { ...s, root, activePaneId: target.id, modal: null };
    });
    this.emitActiveFile();
  }

  /** Request a one-shot scroll-to-span reveal (R14). Pure store set — no side
   *  effects; call AFTER openFile(path) so the target pane is already there. */
  requestReveal(path: string, from: number, to: number): void {
    this.revealTarget.set({ path, from, to });
  }

  /** R180 (G4-b): request the Explorer to reveal `path` (expand ancestors +
   *  select + scroll into view). Opens the left explorer panel so the tree is
   *  visible, then sets the one-shot store the Explorer consumes. */
  requestRevealInExplorer(path: string): void {
    this.setLeftPanel("explorer");
    this.revealInExplorer.set(path);
  }

  /** R184 (G3): request a file op (duplicate/rename/move/new-folder) on `path`
   *  (null for new-folder). Opens the explorer so its tree + inline inputs are
   *  visible, then sets the one-shot store the Explorer routes to vetted handlers. */
  requestExplorerFileAction(
    action: "duplicate" | "rename" | "move" | "new-folder",
    path: string | null,
  ): void {
    this.setLeftPanel("explorer");
    this.explorerFileAction.set({ action, path });
  }

  /** Open the left search panel seeded with `query` (e.g. `#tag` from the Tags pane). */
  requestSearch(query: string) {
    this.searchRequest.set(query);
    this.setLeftPanel("search");
  }

  openGraph() {
    this.update((s) => {
      // a single global graph tab — focus it wherever it lives
      const holder = flattenLeaves(s.root).find((l) => l.tabs.some((t) => t.viewType === "graph"));
      if (holder) {
        const graphTab = holder.tabs.find((t) => t.viewType === "graph")!;
        const root = mapLeaf(s.root, holder.id, (l) => ({ ...l, activeTabId: graphTab.id }));
        return { ...s, root, activePaneId: holder.id, modal: null };
      }
      const tab: TabState = {
        id: newTabId(),
        viewType: "graph",
        filePath: null,
        mode: "preview",
        title: "Graph view",
      };
      const pane = this.resolveActiveLeaf(s);
      const root = mapLeaf(s.root, pane.id, (l) => ({ ...l, tabs: [...l.tabs, tab], activeTabId: tab.id }));
      return { ...s, root, activePaneId: pane.id, modal: null };
    });
    this.emitActiveFile();
  }

  closeTab(id: string) {
    // capture BEFORE the mutation so Mod+Shift+T can reopen it (LIFO). Only an
    // explicit user close feeds this stack — reactive cleanups purge instead.
    const s0 = this.state.get();
    const holder0 = findTabLeaf(s0.root, id);
    const closing = holder0?.tabs.find((t) => t.id === id);
    if (closing && holder0) {
      this.recentlyClosed.push({
        viewType: closing.viewType,
        filePath: closing.filePath,
        mode: closing.mode,
        paneId: holder0.id,
        pinned: closing.pinned,
      });
      if (this.recentlyClosed.length > RECENTLY_CLOSED_MAX) this.recentlyClosed.shift();
    }
    this.update((s) => {
      const holder = findTabLeaf(s.root, id);
      if (!holder) return s;
      const idx = holder.tabs.findIndex((t) => t.id === id);
      let root = mapLeaf(s.root, holder.id, (l) => {
        const tabs = l.tabs.filter((t) => t.id !== id);
        const activeTabId =
          l.activeTabId === id ? tabs[Math.min(idx, tabs.length - 1)]?.id ?? null : l.activeTabId;
        return { ...l, tabs, activeTabId };
      });
      root = normalize(root);
      const activePaneId = findLeaf(root, s.activePaneId)
        ? s.activePaneId
        : flattenLeaves(root)[0].id;
      return { ...s, root, activePaneId };
    });
    this.emitActiveFile();
    this.tabHistory.delete(id);
  }

  /** R81: batch-close helpers for the tab context menu. Each closes via the vetted
   *  `closeTab` path (preserves neighbor activation / recently-closed / flush), and
   *  never touches pinned tabs. The id list is snapshotted first; closeTab re-finds
   *  each (stable) id, so iterating it is safe as the tree shrinks. */
  closeOtherTabs(id: string) {
    this.closeTabBatch(id, "others");
  }
  closeTabsToRight(id: string) {
    this.closeTabBatch(id, "right");
  }
  closeAllTabs(id: string) {
    this.closeTabBatch(id, "all");
  }
  private closeTabBatch(id: string, mode: "others" | "right" | "all") {
    const leaf = findTabLeaf(this.state.get().root, id);
    if (!leaf) return;
    for (const tid of tabIdsToClose(leaf.tabs, id, mode)) this.closeTab(tid);
  }

  /** Close every markdown tab whose filePath no longer exists. One batched state
   *  update (normalize once), preserves graph tabs and the active-pane invariants.
   *  Returns the number of tabs closed. */
  closeMissingFileTabs(exists: (path: string) => boolean): number {
    // collect outside the updater so the count is updater-call-count independent
    const stale = new Set<string>();
    for (const t of allTabs(this.state.get().root)) {
      // R102: any file-backed tab (markdown OR attachment) whose file is gone is stale;
      // graph tabs have filePath === null so are never touched.
      if (t.filePath !== null && !exists(t.filePath)) {
        stale.add(t.id);
      }
    }
    if (stale.size === 0) return 0;
    this.update((s) => {
      let root = mapAllLeaves(s.root, (l) => {
        const tabs = l.tabs.filter((t) => !stale.has(t.id));
        if (tabs.length === l.tabs.length) return l;
        let activeTabId = l.activeTabId;
        if (activeTabId !== null && !tabs.some((t) => t.id === activeTabId)) {
          // closeTab's neighbor rule generalized to batch removal: activate the
          // survivor at the removed active tab's original slot (i.e. the next
          // surviving tab to its right), clamped to the last survivor
          const idx = Math.max(0, l.tabs.findIndex((t) => t.id === activeTabId));
          const survivorsBefore = l.tabs.slice(0, idx).filter((t) => !stale.has(t.id)).length;
          activeTabId = tabs[Math.min(survivorsBefore, tabs.length - 1)]?.id ?? null;
        }
        return { ...l, tabs, activeTabId };
      });
      // normalize once: empty leaves collapse; an all-empty tree falls back to a
      // single empty leaf (normalize never returns a leafless tree)
      root = normalize(root);
      const activePaneId = findLeaf(root, s.activePaneId)
        ? s.activePaneId
        : flattenLeaves(root)[0].id;
      return { ...s, root, activePaneId };
    });
    // a missing file must not linger as the local graph's anchor (same rule as
    // handleDeleted); emitActiveFile re-seeds it from the new active file
    const last = this.lastActiveFile.get();
    if (last !== null && !exists(last)) this.lastActiveFile.set(null);
    console.info(`[workspace] closed ${stale.size} tab(s) pointing at missing files`);
    // a missing file can't be reopened either — purge it from the reopen stack
    this.recentlyClosed = this.recentlyClosed.filter((c) => c.filePath === null || exists(c.filePath));
    this.purgeNavLocations((loc) => exists(loc.filePath));
    this.pruneTabHistory();
    this.emitActiveFile();
    return stale.size;
  }

  /** Activate a tab (and focus the pane that holds it). */
  setActiveTab(id: string) {
    this.update((s) => {
      const holder = findTabLeaf(s.root, id);
      if (!holder) return s;
      const root = mapLeaf(s.root, holder.id, (l) => ({ ...l, activeTabId: id }));
      return { ...s, root, activePaneId: holder.id };
    });
    this.emitActiveFile();
  }

  setTabMode(id: string, mode: ViewMode) {
    this.update((s) => {
      const holder = findTabLeaf(s.root, id);
      if (!holder) return s;
      const root = mapLeaf(s.root, holder.id, (l) => ({
        ...l,
        tabs: l.tabs.map((t) => (t.id === id ? { ...t, mode } : t)),
      }));
      return { ...s, root };
    });
  }

  /** Ctrl+E: toggle between editing (live) and reading view. */
  toggleActiveTabMode() {
    const tab = this.getActiveTab();
    if (tab?.viewType === "markdown") {
      this.setTabMode(tab.id, tab.mode === "preview" ? "live" : "preview");
    }
  }

  /** Toggle the active markdown tab between live preview and raw source. */
  toggleActiveSourceMode() {
    const tab = this.getActiveTab();
    if (tab?.viewType === "markdown") {
      this.setTabMode(tab.id, tab.mode === "source" ? "live" : "source");
    }
  }

  /** R39: toggle a tab's pinned flag. A pinned tab is not replaced by openFile
   *  (links/navigation open a new tab instead). Persisted via update(). */
  toggleTabPin(id: string) {
    this.update((s) => {
      const holder = findTabLeaf(s.root, id);
      if (!holder) return s;
      const root = mapLeaf(s.root, holder.id, (l) => ({
        ...l,
        tabs: l.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
      }));
      return { ...s, root };
    });
  }

  /* ---------- pane management ---------- */

  setActivePane(paneId: string) {
    this.update((s) => (findLeaf(s.root, paneId) ? { ...s, activePaneId: paneId } : s));
    this.emitActiveFile();
  }

  /**
   * Split the active pane. The new sibling pane starts with a duplicate of the
   * active tab (Obsidian behaviour); if the pane is empty the split is a no-op.
   * Returns the new pane's id, or null.
   */
  splitActivePane(direction: SplitDirection): string | null {
    const source = this.getActivePane();
    const srcTab = source?.tabs.find((t) => t.id === source.activeTabId);
    // graph view is a global singleton tab — duplicating it would break openGraph
    if (!source || !srcTab || srcTab.viewType === "graph") return null;
    // a split copy is a NEW tab instance → it does not inherit the source's pin
    // (R39 review; Obsidian pins are per-tab-instance, mirrors R37 "split doesn't
    // copy nav history").
    const dup: TabState = { ...srcTab, id: newTabId(), pinned: undefined };
    const fresh = makeLeaf([dup], dup.id);
    this.update((s) => {
      const root = splitLeafInTree(s.root, source.id, direction, fresh);
      return { ...s, root, activePaneId: fresh.id };
    });
    this.emitActiveFile();
    return fresh.id;
  }

  /**
   * Move a tab into another pane at an index (drag & drop). Source pane
   * collapses if it becomes empty. Keeps the moved tab active in the target.
   */
  moveTab(tabId: string, targetPaneId: string, index?: number) {
    this.update((s) => {
      const sourceLeaf = findTabLeaf(s.root, tabId);
      const targetLeaf = findLeaf(s.root, targetPaneId);
      if (!sourceLeaf || !targetLeaf) return s;
      const tab = sourceLeaf.tabs.find((t) => t.id === tabId)!;

      if (sourceLeaf.id === targetLeaf.id) {
        // reorder within the same pane — callers compute `index` against the
        // ORIGINAL tab list (the dragged tab is still in the DOM), so shift
        // left when the source slot precedes the insertion point
        const srcIdx = sourceLeaf.tabs.findIndex((t) => t.id === tabId);
        const others = sourceLeaf.tabs.filter((t) => t.id !== tabId);
        let at = clampIndex(index, sourceLeaf.tabs.length);
        if (srcIdx < at) at -= 1;
        const tabs = [...others.slice(0, at), tab, ...others.slice(at)];
        const root = mapLeaf(s.root, sourceLeaf.id, (l) => ({ ...l, tabs, activeTabId: tabId }));
        return { ...s, root, activePaneId: sourceLeaf.id };
      }

      let root = mapLeaf(s.root, sourceLeaf.id, (l) => {
        const idx = l.tabs.findIndex((t) => t.id === tabId);
        const tabs = l.tabs.filter((t) => t.id !== tabId);
        const activeTabId =
          l.activeTabId === tabId ? tabs[Math.min(idx, tabs.length - 1)]?.id ?? null : l.activeTabId;
        return { ...l, tabs, activeTabId };
      });
      root = mapLeaf(root, targetLeaf.id, (l) => {
        const at = clampIndex(index, l.tabs.length);
        return {
          ...l,
          tabs: [...l.tabs.slice(0, at), tab, ...l.tabs.slice(at)],
          activeTabId: tabId,
        };
      });
      root = normalize(root);
      const activePaneId = findLeaf(root, targetLeaf.id) ? targetLeaf.id : flattenLeaves(root)[0].id;
      return { ...s, root, activePaneId };
    });
    this.emitActiveFile();
  }

  /**
   * Move a tab to the edge of a pane, creating a new split (drop on pane edge).
   * `edge` is relative to the target pane: left/right → row split, top/bottom → column.
   */
  moveTabToEdge(tabId: string, targetPaneId: string, edge: "left" | "right" | "top" | "bottom") {
    this.update((s) => {
      const sourceLeaf = findTabLeaf(s.root, tabId);
      const targetLeaf = findLeaf(s.root, targetPaneId);
      if (!sourceLeaf || !targetLeaf) return s;
      // moving a pane's only tab onto its own edge is a no-op
      if (sourceLeaf.id === targetLeaf.id && sourceLeaf.tabs.length === 1) return s;
      const tab = sourceLeaf.tabs.find((t) => t.id === tabId)!;

      let root = mapLeaf(s.root, sourceLeaf.id, (l) => {
        const idx = l.tabs.findIndex((t) => t.id === tabId);
        const tabs = l.tabs.filter((t) => t.id !== tabId);
        const activeTabId =
          l.activeTabId === tabId ? tabs[Math.min(idx, tabs.length - 1)]?.id ?? null : l.activeTabId;
        return { ...l, tabs, activeTabId };
      });
      const fresh = makeLeaf([tab], tab.id);
      const direction: SplitDirection = edge === "left" || edge === "right" ? "row" : "column";
      const before = edge === "left" || edge === "top";
      root = splitLeafInTree(root, targetLeaf.id, direction, fresh, before);
      root = normalize(root);
      const activePaneId = findLeaf(root, fresh.id) ? fresh.id : flattenLeaves(root)[0].id;
      return { ...s, root, activePaneId };
    });
    this.emitActiveFile();
  }

  /** Resize children of a split (drag handle). Sizes are clamped + renormalized. */
  setSplitSizes(splitId: string, sizes: number[]) {
    this.update((s) => {
      const root = mapSplit(s.root, splitId, (split) => {
        if (sizes.length !== split.children.length) return split;
        return { ...split, sizes: normalizeSizes(sizes) };
      });
      return root === s.root ? s : { ...s, root };
    });
  }

  /** Cycle focus to the next/previous pane in layout order. */
  focusAdjacentPane(delta: 1 | -1) {
    const s = this.state.get();
    const leaves = flattenLeaves(s.root);
    if (leaves.length < 2) return;
    const idx = leaves.findIndex((l) => l.id === s.activePaneId);
    const next = leaves[(idx + delta + leaves.length) % leaves.length];
    this.setActivePane(next.id);
  }

  /* ---------- tab navigation (R36) ---------- */

  /** Cycle the ACTIVE pane's active tab by delta (+1 next / -1 prev), wrapping.
   *  No-op when the active pane has < 2 tabs. (Obsidian Ctrl+Tab cycles within
   *  the current tab group.) */
  cycleActiveTab(delta: 1 | -1) {
    const leaf = this.getActivePane();
    if (leaf.tabs.length < 2) return;
    const idx = leaf.tabs.findIndex((t) => t.id === leaf.activeTabId);
    const base = idx < 0 ? 0 : idx;
    const next = leaf.tabs[(base + delta + leaf.tabs.length) % leaf.tabs.length];
    this.setActiveTab(next.id);
  }

  /** Activate the tab at 0-based `index` in the active pane; out-of-range = no-op
   *  (Obsidian: Cmd+5 with 3 tabs does nothing). (Mod+1..8 → index 0..7.) */
  activateTabAt(index: number) {
    const tab = this.getActivePane().tabs[index];
    if (tab) this.setActiveTab(tab.id);
  }

  /** Activate the LAST tab in the active pane; no-op when empty. (Mod+9.) */
  activateLastTab() {
    const tabs = this.getActivePane().tabs;
    if (tabs.length === 0) return;
    this.setActiveTab(tabs[tabs.length - 1].id);
  }

  /** Reopen the most-recently user-closed tab (LIFO), restoring its view mode, in
   *  a NEW tab — preferring its original pane if it still exists, else the active
   *  pane (openFile's paneId fallback). Returns whether one was reopened. (Mod+
   *  Shift+T.) */
  reopenClosedTab(): boolean {
    const entry = this.recentlyClosed.pop();
    if (!entry) return false;
    if (entry.viewType === "graph") {
      this.openGraph();
      return true;
    }
    if (entry.filePath === null) return false;
    this.openFile(entry.filePath, { newTab: true, paneId: entry.paneId });
    const tab = this.getActiveTab();
    if (tab && tab.filePath === entry.filePath && tab.mode !== entry.mode) {
      this.setTabMode(tab.id, entry.mode);
    }
    // R39: restore pin state (Obsidian reopens a closed tab with its pin intact)
    if (entry.pinned && tab && tab.filePath === entry.filePath && !tab.pinned) {
      this.toggleTabPin(tab.id);
    }
    return true;
  }

  /* ---------- navigation history (R37) ---------- */

  /** Record the active tab's CURRENT location before openFile replaces it (A→B).
   *  Mirrors openFile's branch decision: skip new-tab (fresh tab) and skip reuse
   *  (switching to an already-open file = tab switch, not navigation). */
  private recordNavigation(s: WorkspaceState, targetPaneId: string, path: string, newTab: boolean) {
    if (newTab) return;
    // R102: attachments open in a fresh tab (no in-place replace) → they never
    // overwrite the active markdown tab, so there is no navigation to record.
    if (isAttachmentPath(path)) return;
    const target = findLeaf(s.root, targetPaneId) ?? flattenLeaves(s.root)[0];
    if (!target) return;
    if (target.tabs.some((t) => t.viewType === "markdown" && t.filePath === path)) return; // reuse → tab switch
    const active = target.tabs.find((t) => t.id === target.activeTabId);
    // a pinned tab is not replaced (R39) → its content doesn't change → don't
    // record a phantom navigation on it (openFile will spawn a new tab instead).
    if (active && active.viewType === "markdown" && active.filePath && active.filePath !== path && !active.pinned) {
      const h = this.tabHistory.get(active.id) ?? { back: [], forward: [] };
      h.back.push({ filePath: active.filePath, mode: active.mode });
      if (h.back.length > NAV_HISTORY_MAX) h.back.shift();
      h.forward = [];
      this.tabHistory.set(active.id, h);
    }
  }

  /** Cmd/Ctrl+Alt+Left: step the active tab back through its history. */
  navigateBack() {
    this.navigate("back");
  }

  /** Cmd/Ctrl+Alt+Right: step the active tab forward. */
  navigateForward() {
    this.navigate("forward");
  }

  private navigate(dir: "back" | "forward") {
    const tab = this.getActiveTab();
    if (!tab || tab.viewType !== "markdown" || tab.filePath === null) return;
    const h = this.tabHistory.get(tab.id);
    if (!h) return;
    const src = dir === "back" ? h.back : h.forward;
    const dst = dir === "back" ? h.forward : h.back;
    const target = src.pop();
    if (!target) return;
    dst.push({ filePath: tab.filePath, mode: tab.mode });
    this.tabHistory.set(tab.id, h);
    this.setTabLocation(tab.id, target.filePath, target.mode);
  }

  canTabNavigateBack(tabId: string): boolean {
    return (this.tabHistory.get(tabId)?.back.length ?? 0) > 0;
  }

  canTabNavigateForward(tabId: string): boolean {
    return (this.tabHistory.get(tabId)?.forward.length ?? 0) > 0;
  }

  /** Set a tab's location WITHOUT recording navigation (back/forward use this). */
  private setTabLocation(tabId: string, filePath: string, mode: ViewMode) {
    this.update((s) => {
      const holder = findTabLeaf(s.root, tabId);
      if (!holder) return s;
      const root = mapLeaf(s.root, holder.id, (l) => ({
        ...l,
        tabs: l.tabs.map((t) =>
          t.id === tabId ? { ...t, filePath, title: stripExtension(basename(filePath)), mode } : t,
        ),
        activeTabId: tabId,
      }));
      return { ...s, root, activePaneId: holder.id };
    });
    this.emitActiveFile();
  }

  /** Remove every tab's history entries failing `keep` (delete/missing purge). */
  private purgeNavLocations(keep: (loc: NavLocation) => boolean) {
    for (const h of this.tabHistory.values()) {
      h.back = h.back.filter(keep);
      h.forward = h.forward.filter(keep);
    }
  }

  /** Drop history for tabs that no longer exist (after batch tab removal). */
  private pruneTabHistory() {
    const live = new Set(allTabs(this.state.get().root).map((t) => t.id));
    for (const id of this.tabHistory.keys()) {
      if (!live.has(id)) this.tabHistory.delete(id);
    }
  }

  /* ---------- panels / modals / theme ---------- */

  setLeftPanel(panel: LeftPanelKind) {
    this.update((s) => ({ ...s, leftPanel: panel, leftSidebarOpen: true }));
  }

  setRightPanel(panel: RightPanelKind) {
    this.update((s) => ({ ...s, rightPanel: panel, rightSidebarOpen: true }));
  }

  /** Resize a sidebar (clamped); used by the drag handles in the shell. */
  setSidebarWidth(side: "left" | "right", px: number) {
    const clamped = Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, Math.round(px)));
    this.update((s) =>
      side === "left" ? { ...s, leftWidth: clamped } : { ...s, rightWidth: clamped },
    );
  }

  toggleLeftSidebar() {
    this.update((s) => ({ ...s, leftSidebarOpen: !s.leftSidebarOpen }));
  }

  toggleRightSidebar() {
    this.update((s) => ({ ...s, rightSidebarOpen: !s.rightSidebarOpen }));
  }

  openModal(modal: Exclude<ModalKind, null>) {
    this.update((s) => ({ ...s, modal }));
  }

  closeModal() {
    this.update((s) => ({ ...s, modal: null }));
  }

  /* ---------- named workspace layouts (R45) ---------- */

  /** A clean, alias-free JSON snapshot of the current layout (same shape that
   *  `persist()` serializes: `modal` forced null). Opaque to callers — fed back
   *  verbatim to `applyLayout`. Deep-copied so no Store internals are aliased. */
  captureLayout(): unknown {
    const snapshot = JSON.parse(
      JSON.stringify({ ...this.state.get(), modal: null }),
    ) as Record<string, unknown>;
    // appearance (theme/fontSize) is GLOBAL, not part of a workspace — never
    // store or restore it (R45 review; Obsidian workspaces save layout only).
    delete snapshot.theme;
    delete snapshot.fontSize;
    return snapshot;
  }

  /** Restore a previously captured layout. `raw` runs through the same
   *  `sanitizeState` used by `restore()`, so a malformed/foreign snapshot can
   *  never corrupt the workspace. Setting `state` drives EditorPane remounts
   *  (identical to `restore()`); then tabs pointing at now-missing files are
   *  pruned via `exists`, and the result is persisted. */
  applyLayout(raw: unknown, exists: (path: string) => boolean): void {
    const current = this.state.get();
    const next = sanitizeState(raw);
    // appearance stays global — a saved layout must never change theme/fontSize
    // (R45 review): keep the current values regardless of what the snapshot held.
    next.theme = current.theme;
    next.fontSize = current.fontSize;
    this.state.set(next);
    this.closeMissingFileTabs(exists);
    // a layout swap is a structural change like reconcile-with-vault: drop session
    // nav history for tabs not in the new tree, and re-seed lastActiveFile + the
    // derived panels (backlinks/outline) for the new active tab (R45 review).
    this.pruneTabHistory();
    this.emitActiveFile();
    this.persist();
  }

  /* ---------- properties-in-document display preference (R22) ---------- */

  /** "visible" = structured panel, "hidden" = nothing, "source" = raw YAML.
   *  localStorage-persisted, NOT part of the persisted WorkspaceState tree. */
  readonly propertiesInDocument = new Store<"visible" | "hidden" | "source">(
    ((): "visible" | "hidden" | "source" => {
      try {
        const v = localStorage.getItem("geode.propertiesInDocument");
        return v === "hidden" || v === "source" ? v : "visible";
      } catch {
        return "visible";
      }
    })(),
  );

  setPropertiesInDocument(v: "visible" | "hidden" | "source") {
    this.propertiesInDocument.set(v);
    try {
      localStorage.setItem("geode.propertiesInDocument", v);
    } catch {
      /* storage unavailable — session-only */
    }
  }

  /** One-shot "add file property" request (R22) — same consume-once shape as
   *  revealTarget (R14). The command sets it; the matching tab's
   *  PropertiesPanel consumes it once it is mounted and connected (a
   *  synchronous window event would fire before the panel exists when the
   *  command flips source → live). Carries the file path so a request left
   *  hanging while the tab navigates elsewhere is DISCARDED instead of
   *  writing an empty frontmatter block into a file the user never touched
   *  (R22 review fix INT-2/SEC-03). */
  readonly addPropertyRequest = new Store<{ tabId: string; filePath: string } | null>(null);

  requestAddProperty(tabId: string, filePath: string) {
    this.addPropertyRequest.set({ tabId, filePath });
  }

  setTheme(theme: ThemeKind) {
    this.update((s) => ({ ...s, theme }));
    // R79: state.theme holds the kind (may be "system"); the event + dataset
    // always carry the RESOLVED concrete theme so consumers stay dark/light.
    const resolved = resolveTheme(theme, systemPrefersDark());
    document.documentElement.dataset.theme = resolved;
    this.events.emit("theme:changed", { theme: resolved });
  }

  toggleTheme() {
    const resolved = resolveTheme(this.state.get().theme, systemPrefersDark());
    this.setTheme(resolved === "dark" ? "light" : "dark");
  }

  /** R79: re-resolve "system" theme when the OS color scheme flips. Call once at
   *  boot. No-op where matchMedia is unavailable. */
  watchSystemTheme() {
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", () => {
        if (this.state.get().theme !== "system") return;
        const resolved = resolveTheme("system", mq.matches);
        document.documentElement.dataset.theme = resolved;
        this.events.emit("theme:changed", { theme: resolved });
      });
    } catch {
      /* no matchMedia (non-browser context) */
    }
  }

  setFontSize(px: number) {
    const clamped = Math.max(11, Math.min(28, Math.round(px)));
    this.update((s) => ({ ...s, fontSize: clamped }));
    document.documentElement.style.setProperty("--editor-font-size", `${clamped}px`);
  }

  /* ---------- flushers ---------- */

  /** Register a flush callback (e.g. pending editor saves); returns a disposer. */
  registerFlusher(fn: () => void | Promise<void>): () => void {
    this.flushers.add(fn);
    return () => {
      this.flushers.delete(fn);
    };
  }

  /** Run every registered flusher and await them all. Never throws. */
  async flushAll(): Promise<void> {
    await Promise.all(
      [...this.flushers].map(async (fn) => {
        try {
          await fn();
        } catch (err) {
          console.error("[workspace] flusher threw", err);
        }
      }),
    );
  }

  /** apply theme/font side effects on startup */
  applyDocumentEffects() {
    const s = this.state.get();
    document.documentElement.dataset.theme = resolveTheme(s.theme, systemPrefersDark());
    document.documentElement.style.setProperty("--editor-font-size", `${s.fontSize}px`);
  }

  /* ---------- internals ---------- */

  private resolveActiveLeaf(s: WorkspaceState): PaneLeaf {
    return findLeaf(s.root, s.activePaneId) ?? flattenLeaves(s.root)[0];
  }

  private handleDeleted(path: string) {
    this.update((s) => {
      let root = mapAllLeaves(s.root, (l) => {
        const tabs = l.tabs.filter(
          // R102: close any file-backed tab (markdown OR attachment) under the deleted
          // path; graph tabs have filePath === null so are never matched.
          (t) => !(t.filePath && (t.filePath === path || t.filePath.startsWith(path + "/"))),
        );
        if (tabs.length === l.tabs.length) return l;
        const activeTabId = tabs.some((t) => t.id === l.activeTabId)
          ? l.activeTabId
          : tabs[tabs.length - 1]?.id ?? null;
        return { ...l, tabs, activeTabId };
      });
      root = normalize(root);
      const activePaneId = findLeaf(root, s.activePaneId)
        ? s.activePaneId
        : flattenLeaves(root)[0].id;
      return { ...s, root, activePaneId };
    });
    // a deleted file must not linger as the local graph's anchor; emitActiveFile
    // below re-seeds it from the new active file when there is one
    const last = this.lastActiveFile.get();
    if (last !== null && (last === path || last.startsWith(path + "/"))) {
      this.lastActiveFile.set(null);
    }
    // a deleted file can never be reopened — drop it from the reopen stack
    this.recentlyClosed = this.recentlyClosed.filter(
      (c) => !(c.filePath !== null && (c.filePath === path || c.filePath.startsWith(path + "/"))),
    );
    // purge deleted-file locations from every tab's nav history, drop dead tabs' history (R37)
    this.purgeNavLocations((loc) => loc.filePath !== path && !loc.filePath.startsWith(path + "/"));
    this.pruneTabHistory();
    this.emitActiveFile();
  }

  private handleRenamed(oldPath: string, newPath: string) {
    this.update((s) => ({
      ...s,
      root: mapAllLeaves(s.root, (l) => ({
        ...l,
        tabs: l.tabs.map((t) => {
          // R102: retarget any file-backed tab (markdown OR attachment) on rename;
          // graph tabs have filePath === null so are skipped. The viewType is RE-DERIVED
          // from the new path (review fix) — a cross-type rename (note.md → note.png) must
          // flip an editable tab to the read-only attachment view, never leave a binary in
          // the editable/autosave path (the dirty buffer follows the handle's retarget, so
          // EditorPane's deferred-drop flush still writes it to the new path — no loss).
          if (!t.filePath) return t;
          if (t.filePath === oldPath) {
            return retargetFileTab(t, newPath);
          }
          if (t.filePath.startsWith(oldPath + "/")) {
            return retargetFileTab(t, newPath + t.filePath.slice(oldPath.length));
          }
          return t;
        }),
      })),
    }));
    // remap directly: the choke point can't see this rename when a non-markdown
    // tab (graph) is active — getActiveFile() is null and the guard keeps the
    // stale old path, breaking the local graph's anchor
    const last = this.lastActiveFile.get();
    if (last === oldPath) {
      this.lastActiveFile.set(newPath);
    } else if (last !== null && last.startsWith(oldPath + "/")) {
      this.lastActiveFile.set(newPath + last.slice(oldPath.length));
    }
    // keep the reopen stack pointing at the renamed path (same rule as tabs)
    this.recentlyClosed = this.recentlyClosed.map((c) => {
      if (c.filePath === null) return c;
      if (c.filePath === oldPath) return { ...c, filePath: newPath };
      if (c.filePath.startsWith(oldPath + "/")) {
        return { ...c, filePath: newPath + c.filePath.slice(oldPath.length) };
      }
      return c;
    });
    // keep nav-history locations pointing at the renamed path (R37)
    const remapLoc = (loc: NavLocation): NavLocation =>
      loc.filePath === oldPath
        ? { ...loc, filePath: newPath }
        : loc.filePath.startsWith(oldPath + "/")
          ? { ...loc, filePath: newPath + loc.filePath.slice(oldPath.length) }
          : loc;
    for (const h of this.tabHistory.values()) {
      h.back = h.back.map(remapLoc);
      h.forward = h.forward.map(remapLoc);
    }
    this.emitActiveFile();
  }

  private emitActiveFile() {
    const path = this.getActiveFile();
    // single choke point for active-file changes — keep the last non-null file
    if (path !== null) this.lastActiveFile.set(path);
    this.events.emit("active-file:changed", { path });
  }

  private update(fn: (s: WorkspaceState) => WorkspaceState) {
    const prevModal = this.state.get().modal;
    this.state.update(fn);
    this.persist();
    if (prevModal !== null && this.state.get().modal === null) {
      this.events.emit("modal:closed", {});
    }
  }

  private persist() {
    if (isBenchSession()) return; // bench vaults must not leak tabs into the real workspace
    try {
      const s = this.state.get();
      localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({ ...s, modal: null }),
      );
    } catch {
      /* storage unavailable — fine */
    }
  }

  private restore() {
    if (isBenchSession()) return;
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      this.state.set(sanitizeState(JSON.parse(raw)));
    } catch {
      /* corrupted state — start fresh */
    }
  }
}

/* ================= tree surgery ================= */

/**
 * Split `paneId` in `direction`, inserting `fresh` as its sibling (after it,
 * or before when `before`). If the parent split already runs in `direction`,
 * the new pane is inserted at the same level instead of nesting.
 */
function splitLeafInTree(
  root: PaneNode,
  paneId: string,
  direction: SplitDirection,
  fresh: PaneLeaf,
  before = false,
): PaneNode {
  const insert = (node: PaneNode): PaneNode | "not-found" => {
    if (node.kind === "leaf") {
      if (node.id !== paneId) return "not-found";
      const children = before ? [fresh, node] : [node, fresh];
      const split: PaneSplit = {
        kind: "split",
        id: newPaneId(),
        direction,
        children,
        sizes: [0.5, 0.5],
      };
      return split;
    }
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      // flatten: target is a direct child leaf and directions match
      if (child.kind === "leaf" && child.id === paneId && node.direction === direction) {
        const share = (node.sizes[i] ?? 1 / node.children.length) / 2;
        const children = [...node.children];
        const sizes = [...node.sizes];
        children.splice(before ? i : i + 1, 0, fresh);
        sizes[i] = share;
        sizes.splice(before ? i : i + 1, 0, share);
        return { ...node, children, sizes };
      }
      const result = insert(child);
      if (result !== "not-found") {
        const children = [...node.children];
        children[i] = result;
        return { ...node, children };
      }
    }
    return "not-found";
  };
  const result = insert(root);
  return result === "not-found" ? root : result;
}

function mapSplit(node: PaneNode, splitId: string, fn: (s: PaneSplit) => PaneSplit): PaneNode {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return fn(node);
  let changed = false;
  const children = node.children.map((c) => {
    const next = mapSplit(c, splitId, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/**
 * Renormalize split sizes so they sum to 1 while every child stays at or above
 * MIN_PANE_FRACTION. Violators are pinned to the floor and the remainder is
 * distributed proportionally among the rest (iterating in case that creates
 * new violators). Falls back to equal sizes when the floor is unsatisfiable.
 */
function normalizeSizes(sizes: number[]): number[] {
  const n = sizes.length;
  if (n === 0) return [];
  if (n * MIN_PANE_FRACTION >= 1) return sizes.map(() => 1 / n);
  let vals = sizes.map((v) => (Number.isFinite(v) && v > 0 ? v : 1 / n));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  vals = vals.map((v) => v / total);
  for (let pass = 0; pass < n; pass++) {
    const low = vals.map((v) => v < MIN_PANE_FRACTION);
    if (!low.some(Boolean)) break;
    if (low.every(Boolean)) return vals.map(() => 1 / n);
    const pinned = low.filter(Boolean).length * MIN_PANE_FRACTION;
    const freeSum = vals.reduce((a, v, i) => (low[i] ? a : a + v), 0);
    vals = vals.map((v, i) => (low[i] ? MIN_PANE_FRACTION : (v * (1 - pinned)) / freeSum));
  }
  return vals;
}

function clampIndex(index: number | undefined, len: number): number {
  if (index === undefined || !Number.isFinite(index)) return len;
  return Math.max(0, Math.min(len, Math.floor(index)));
}

function paneId0(s: WorkspaceState, id: string): string {
  return findLeaf(s.root, id) ? id : s.activePaneId;
}

/* ================= persisted-state sanitizing / migration ================= */

function sanitizeTab(raw: unknown): TabState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || typeof t.title !== "string") return null;
  if (t.viewType !== "markdown" && t.viewType !== "graph" && t.viewType !== "attachment") return null;
  // migrate pre-R2 "edit" mode to live preview
  const mode: ViewMode =
    t.mode === "preview" ? "preview" : t.mode === "source" ? "source" : "live";
  if (typeof t.filePath !== "string" && t.filePath !== null) return null;
  const filePath = t.filePath;
  // R102: RE-derive a file-backed tab's viewType from its path (not the persisted value),
  // so a pre-R102 blob that stored a .png as an editable "markdown" tab — or a file whose
  // type changed while the app was closed — can never restore into the editable/autosave
  // path (binary corruption on edit). graph keeps its persisted type (filePath === null).
  const viewType: TabState["viewType"] =
    t.viewType === "graph" ? "graph" : filePath !== null ? fileViewType(filePath) : "markdown";
  const tab: TabState = { id: t.id, viewType, filePath, mode, title: t.title };
  if (t.pinned === true) tab.pinned = true; // R39: persist pin state (omit when false)
  return tab;
}

function sanitizeNode(
  raw: unknown,
  seenTabIds: Set<string>,
  seenPaneIds: Set<string>,
): PaneNode | null {
  if (typeof raw !== "object" || raw === null) return null;
  const n = raw as Record<string, unknown>;
  // duplicate pane ids would corrupt every id-targeted tree operation
  const paneId = (id: unknown): string => {
    const candidate = typeof id === "string" && !seenPaneIds.has(id) ? id : newPaneId();
    seenPaneIds.add(candidate);
    return candidate;
  };
  if (n.kind === "leaf") {
    if (!Array.isArray(n.tabs)) return null;
    const tabs: TabState[] = [];
    for (const t of n.tabs) {
      const tab = sanitizeTab(t);
      if (tab && !seenTabIds.has(tab.id)) {
        seenTabIds.add(tab.id);
        tabs.push(tab);
      }
    }
    const activeTabId = tabs.some((t) => t.id === n.activeTabId)
      ? (n.activeTabId as string)
      : tabs[0]?.id ?? null;
    return { kind: "leaf", id: paneId(n.id), tabs, activeTabId };
  }
  if (n.kind === "split") {
    if (!Array.isArray(n.children)) return null;
    if (n.direction !== "row" && n.direction !== "column") return null;
    const children: PaneNode[] = [];
    for (const c of n.children) {
      const node = sanitizeNode(c, seenTabIds, seenPaneIds);
      if (node) children.push(node);
    }
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    const rawSizes = Array.isArray(n.sizes) ? n.sizes : [];
    const sizes = children.map((_, i) => {
      const v = rawSizes[i];
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1 / children.length;
    });
    return {
      kind: "split",
      id: paneId(n.id),
      direction: n.direction,
      children,
      sizes: normalizeSizes(sizes),
    };
  }
  return null;
}

/** Validate a persisted (untrusted) state shape; migrates the v1 flat-tabs shape. */
function sanitizeState(saved: unknown): WorkspaceState {
  const base = defaultState();
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return base;
  const s = saved as Record<string, unknown>;

  let root: PaneNode | null = null;
  if (s.root) {
    root = sanitizeNode(s.root, new Set(), new Set());
    if (root) root = normalize(root);
  } else if (Array.isArray(s.tabs)) {
    // v1 migration: flat tab list becomes a single leaf
    const tabs: TabState[] = [];
    const seen = new Set<string>();
    for (const raw of s.tabs) {
      const tab = sanitizeTab(raw);
      if (tab && !seen.has(tab.id)) {
        seen.add(tab.id);
        tabs.push(tab);
      }
    }
    const activeTabId = tabs.some((t) => t.id === s.activeTabId)
      ? (s.activeTabId as string)
      : tabs[0]?.id ?? null;
    root = makeLeaf(tabs, activeTabId);
  }
  if (!root) return base;

  const leaves = flattenLeaves(root);
  if (leaves.length === 0) return base;
  const activePaneId = leaves.some((l) => l.id === s.activePaneId)
    ? (s.activePaneId as string)
    : leaves[0].id;

  const fontSize =
    typeof s.fontSize === "number" && Number.isFinite(s.fontSize)
      ? Math.max(11, Math.min(28, Math.round(s.fontSize)))
      : base.fontSize;

  const width = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, Math.round(v)))
      : fallback;

  return {
    root,
    activePaneId,
    // any non-empty string is a valid panel id (dynamic sidebar panels, R5);
    // unknown ids render the default panel in the shell WITHOUT mutating state
    leftPanel: typeof s.leftPanel === "string" && s.leftPanel !== "" ? s.leftPanel : base.leftPanel,
    rightPanel:
      typeof s.rightPanel === "string" && s.rightPanel !== "" ? s.rightPanel : base.rightPanel,
    leftSidebarOpen: Boolean(s.leftSidebarOpen ?? base.leftSidebarOpen),
    rightSidebarOpen: Boolean(s.rightSidebarOpen ?? base.rightSidebarOpen),
    leftWidth: width(s.leftWidth, base.leftWidth),
    rightWidth: width(s.rightWidth, base.rightWidth),
    modal: null,
    // R79: accept the new "system" kind; legacy "dark"/"light" unchanged, any
    // unknown value falls back to "dark".
    theme: s.theme === "light" || s.theme === "system" ? s.theme : "dark",
    fontSize,
  };
}
