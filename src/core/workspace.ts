import type {
  LeftPanelKind,
  ModalKind,
  RightPanelKind,
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
const newTabId = () => `tab-${++tabCounter}-${Math.random().toString(36).slice(2, 7)}`;

const DEFAULT_STATE: WorkspaceState = {
  tabs: [],
  activeTabId: null,
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

const MIN_SIDEBAR_W = 170;
const MAX_SIDEBAR_W = 560;

/**
 * Workspace — open tabs, sidebars, modals, theme. Persisted to localStorage.
 * All mutations go through methods so persistence + events stay consistent.
 */
export class Workspace {
  readonly state = new Store<WorkspaceState>(DEFAULT_STATE);
  private flushers = new Set<() => void | Promise<void>>();

  constructor(private events: EventBus) {
    this.restore();
    // when a file is deleted/renamed, fix tabs that point at it
    events.on("file:deleted", ({ path }) => this.handleDeleted(path));
    events.on("file:renamed", ({ oldPath, newPath }) => this.handleRenamed(oldPath, newPath));
  }

  /* ---------- selectors ---------- */

  getActiveTab(): TabState | null {
    const s = this.state.get();
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  }

  getActiveFile(): string | null {
    const tab = this.getActiveTab();
    return tab?.viewType === "markdown" ? tab.filePath : null;
  }

  /* ---------- tab management ---------- */

  /** Open a file. Reuses an existing tab for the same file unless newTab. */
  openFile(path: string, opts: { newTab?: boolean } = {}) {
    this.update((s) => {
      const existing = s.tabs.find((t) => t.viewType === "markdown" && t.filePath === path);
      if (existing && !opts.newTab) {
        return { ...s, activeTabId: existing.id, modal: null };
      }
      const active = s.tabs.find((t) => t.id === s.activeTabId);
      // replace the active markdown tab's content (Obsidian default behaviour)
      if (active && active.viewType === "markdown" && !opts.newTab) {
        const tabs = s.tabs.map((t) =>
          t.id === active.id ? { ...t, filePath: path, title: stripExtension(basename(path)) } : t,
        );
        return { ...s, tabs, modal: null };
      }
      const tab: TabState = {
        id: newTabId(),
        viewType: "markdown",
        filePath: path,
        mode: "live",
        title: stripExtension(basename(path)),
      };
      return { ...s, tabs: [...s.tabs, tab], activeTabId: tab.id, modal: null };
    });
    this.emitActiveFile();
  }

  openGraph() {
    this.update((s) => {
      const existing = s.tabs.find((t) => t.viewType === "graph");
      if (existing) return { ...s, activeTabId: existing.id, modal: null };
      const tab: TabState = {
        id: newTabId(),
        viewType: "graph",
        filePath: null,
        mode: "preview",
        title: "Graph view",
      };
      return { ...s, tabs: [...s.tabs, tab], activeTabId: tab.id, modal: null };
    });
    this.emitActiveFile();
  }

  closeTab(id: string) {
    this.update((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (s.activeTabId === id) {
        activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
      }
      return { ...s, tabs, activeTabId };
    });
    this.emitActiveFile();
  }

  setActiveTab(id: string) {
    this.update((s) => ({ ...s, activeTabId: id }));
    this.emitActiveFile();
  }

  setTabMode(id: string, mode: ViewMode) {
    this.update((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, mode } : t)),
    }));
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

  private handleDeleted(path: string) {
    this.update((s) => {
      const tabs = s.tabs.filter(
        (t) => !(t.viewType === "markdown" && t.filePath && (t.filePath === path || t.filePath.startsWith(path + "/"))),
      );
      const activeTabId = tabs.some((t) => t.id === s.activeTabId)
        ? s.activeTabId
        : tabs[tabs.length - 1]?.id ?? null;
      return { ...s, tabs, activeTabId };
    });
    this.emitActiveFile();
  }

  private handleRenamed(oldPath: string, newPath: string) {
    this.update((s) => ({
      ...s,
      tabs: s.tabs.map((t) => {
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
    }));
  }

  private emitActiveFile() {
    this.events.emit("active-file:changed", { path: this.getActiveFile() });
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
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      this.state.set(sanitizeState(JSON.parse(raw)));
    } catch {
      /* corrupted state — start fresh */
    }
  }
}

/** Validate a persisted (untrusted) state shape; fall back to DEFAULT_STATE. */
function sanitizeState(saved: unknown): WorkspaceState {
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return DEFAULT_STATE;
  const s = saved as Record<string, unknown>;
  if (!Array.isArray(s.tabs)) return DEFAULT_STATE;

  const tabs: TabState[] = [];
  for (const raw of s.tabs) {
    if (typeof raw !== "object" || raw === null) continue;
    const t = raw as Record<string, unknown>;
    if (typeof t.id !== "string" || typeof t.title !== "string") continue;
    if (t.viewType !== "markdown" && t.viewType !== "graph") continue;
    // migrate pre-R2 "edit" mode to live preview
    const mode: ViewMode =
      t.mode === "preview" ? "preview" : t.mode === "source" ? "source" : "live";
    if (typeof t.filePath !== "string" && t.filePath !== null) continue;
    tabs.push({
      id: t.id,
      viewType: t.viewType,
      filePath: t.filePath,
      mode,
      title: t.title,
    });
  }

  const fontSize =
    typeof s.fontSize === "number" && Number.isFinite(s.fontSize)
      ? Math.max(11, Math.min(28, Math.round(s.fontSize)))
      : DEFAULT_STATE.fontSize;

  const width = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, Math.round(v)))
      : fallback;

  return {
    tabs,
    activeTabId: tabs.some((t) => t.id === s.activeTabId) ? (s.activeTabId as string) : null,
    leftPanel: s.leftPanel === "search" ? "search" : "explorer",
    rightPanel: s.rightPanel === "outline" ? "outline" : "backlinks",
    leftSidebarOpen: Boolean(s.leftSidebarOpen ?? DEFAULT_STATE.leftSidebarOpen),
    rightSidebarOpen: Boolean(s.rightSidebarOpen ?? DEFAULT_STATE.rightSidebarOpen),
    leftWidth: width(s.leftWidth, DEFAULT_STATE.leftWidth),
    rightWidth: width(s.rightWidth, DEFAULT_STATE.rightWidth),
    modal: null,
    theme: s.theme === "light" ? "light" : "dark",
    fontSize,
  };
}
