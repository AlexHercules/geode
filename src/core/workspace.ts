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
import { basename, stripExtension } from "./vault";

const PERSIST_KEY = "geode.workspace.v1";
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
  private flushers = new Set<() => void | Promise<void>>();

  constructor(private events: EventBus) {
    this.restore();
    this.lastActiveFile.set(this.getActiveFile());
    // when a file is deleted/renamed, fix tabs that point at it
    events.on("file:deleted", ({ path }) => this.handleDeleted(path));
    events.on("file:renamed", ({ oldPath, newPath }) => this.handleRenamed(oldPath, newPath));
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
    this.update((s) => {
      const paneId = opts.paneId ? paneId0(s, opts.paneId) : s.activePaneId;
      const target = findLeaf(s.root, paneId) ?? flattenLeaves(s.root)[0];
      let root = s.root;

      const existing = target.tabs.find((t) => t.viewType === "markdown" && t.filePath === path);
      if (existing && !opts.newTab) {
        root = mapLeaf(root, target.id, (l) => ({ ...l, activeTabId: existing.id }));
        return { ...s, root, activePaneId: target.id, modal: null };
      }
      const active = target.tabs.find((t) => t.id === target.activeTabId);
      // replace the active markdown tab's content (Obsidian default behaviour)
      if (active && active.viewType === "markdown" && !opts.newTab) {
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
        viewType: "markdown",
        filePath: path,
        mode: "live",
        title: stripExtension(basename(path)),
      };
      root = mapLeaf(root, target.id, (l) => ({ ...l, tabs: [...l.tabs, tab], activeTabId: tab.id }));
      return { ...s, root, activePaneId: target.id, modal: null };
    });
    this.emitActiveFile();
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
    const dup: TabState = { ...srcTab, id: newTabId() };
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

  setTheme(theme: ThemeKind) {
    this.update((s) => ({ ...s, theme }));
    document.documentElement.dataset.theme = theme;
    this.events.emit("theme:changed", { theme });
  }

  toggleTheme() {
    this.setTheme(this.state.get().theme === "dark" ? "light" : "dark");
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
    document.documentElement.dataset.theme = s.theme;
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
          (t) =>
            !(t.viewType === "markdown" && t.filePath && (t.filePath === path || t.filePath.startsWith(path + "/"))),
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
    this.emitActiveFile();
  }

  private handleRenamed(oldPath: string, newPath: string) {
    this.update((s) => ({
      ...s,
      root: mapAllLeaves(s.root, (l) => ({
        ...l,
        tabs: l.tabs.map((t) => {
          if (t.viewType !== "markdown" || !t.filePath) return t;
          if (t.filePath === oldPath) {
            return { ...t, filePath: newPath, title: stripExtension(basename(newPath)) };
          }
          if (t.filePath.startsWith(oldPath + "/")) {
            const p = newPath + t.filePath.slice(oldPath.length);
            return { ...t, filePath: p, title: stripExtension(basename(p)) };
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
  if (t.viewType !== "markdown" && t.viewType !== "graph") return null;
  // migrate pre-R2 "edit" mode to live preview
  const mode: ViewMode =
    t.mode === "preview" ? "preview" : t.mode === "source" ? "source" : "live";
  if (typeof t.filePath !== "string" && t.filePath !== null) return null;
  return { id: t.id, viewType: t.viewType, filePath: t.filePath, mode, title: t.title };
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
    theme: s.theme === "light" ? "light" : "dark",
    fontSize,
  };
}
