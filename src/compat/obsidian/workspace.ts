/**
 * Obsidian Workspace shim (API-REFERENCE area 4) over the Geode pane tree.
 * Two leaf kinds (R5): the active-pane facade (file-centric, command-driven
 * plugins) and SidebarViewLeaf — a REAL mount point for registerView custom
 * views, hosted as Geode sidebar panels (PluginManager.addSidebarPanel).
 */
import { openSearchPanel } from "@codemirror/search";
import type { AppHandle } from "@core/plugins";
import { findActiveTab } from "@core/workspace";
import { Editor } from "./editor";
import { Events, type EventRef } from "./events";
import type { FileRegistry, TAbstractFile, TFile } from "./files";
import { reportGap } from "./gaps";
import { getIconSvg } from "./icons";
import type { App } from "./plugin";
import type { Menu } from "./ui";
import { parseLinktext } from "./util";
// value import is safe: view.ts only imports type-only symbols from this file
import { FileView, type View } from "./view";

type Handle = Omit<AppHandle, "ui">;
export type PaneType = "tab" | "split" | "window";
export type SplitDirection = "vertical" | "horizontal";

/**
 * Official `OpenViewState` (d.ts:4756) — the optional 4th arg of openLinkText.
 * `eState` typically carries the ephemeral scroll target (subpath/line); v1 only
 * honours the linktext subpath, so these fields are declared for type fidelity
 * but not yet consumed (recorded deviation).
 */
export interface OpenViewState {
  state?: Record<string, unknown>;
  eState?: Record<string, unknown>;
  active?: boolean;
  group?: WorkspaceLeaf;
}

/**
 * R137: map an Obsidian markdown view-state mode to a Geode ViewMode and apply it to the active tab —
 * the shared path behind openFile's `openState.mode` and setViewState's `state.mode` (Obsidian's
 * programmatic mode switch; there is no public MarkdownView.setMode). Obsidian's `source` boolean
 * distinguishes live-preview (false) from raw source (true); absent ⇒ raw, matching the legacy
 * openFile collapse. Unrecognized mode ⇒ no-op.
 */
function applyViewStateMode(handle: Handle, mode: string | undefined, source: boolean | undefined): void {
  const vm = mode === "preview" ? "preview" : mode === "source" ? (source === false ? "live" : "source") : null;
  if (!vm) return;
  const tab = findActiveTab(handle.workspace.state.get());
  // R137 review: only markdown tabs have a reading/source/live mode — guard like the Ctrl+E toggles
  // (toggleActiveTabMode), so a mode-only setViewState on a graph/attachment tab doesn't stamp it.
  if (tab && tab.viewType === "markdown") handle.workspace.setTabMode(tab.id, vm);
}

/** 'export type ViewCreator = (leaf: WorkspaceLeaf) => View;' (official d.ts) */
export type ViewCreator = (leaf: WorkspaceLeaf) => View;

/**
 * Markdown view facade for editorCallback ctx / getActiveViewOfType. A real
 * FileView (F8) so plugin checks like `view instanceof FileView/ItemView/View`
 * hold; getDisplayText comes from FileView (file?.basename ?? "").
 */
export class MarkdownView extends FileView {
  editor: Editor;

  constructor(leaf: WorkspaceLeaf, editor: Editor, file: TFile | null) {
    super(leaf);
    this.editor = editor;
    this.file = file;
  }

  override getViewType(): string {
    return "markdown";
  }

  /** R116: Obsidian `MarkdownView.getMode()` — "source" (editor: live OR source) or
   *  "preview" (reading). A compat MarkdownView is ONLY ever built over the editor
   *  `getActiveView()` tracks (set on CM focus); Geode's reading view is not CM-backed
   *  and never enters that tracker — so any MarkdownView Geode can hand a plugin wraps a
   *  real editor and is always "source". (Don't read the active TAB's mode here: the
   *  active tab and the active editor are independent sources and can point at different
   *  tabs in a split, which would report "preview" over a live editor — review R116.) */
  getMode(): "source" | "preview" {
    return "source";
  }

  /** R116: Obsidian `MarkdownView.getViewData()` — the editor's raw markdown source. */
  getViewData(): string {
    return this.editor.getValue();
  }

  /** R123: Obsidian `MarkdownView.setViewData(data, clear)` — replace the editor's full
   *  content. Routes through editor.setValue → ONE undoable CM transaction → the doc-change
   *  listener → autosave (the normal save cycle), so the replacement persists safely, exactly
   *  like a large paste. `clear` (Obsidian resets the undo history on a fresh file load) is
   *  IGNORED: the replacement stays a normal undoable edit, strictly safer than dropping
   *  history (documented deviation). `setMode` stays a gap — its real arg is an internal
   *  MarkdownSubView; plugins switch mode via leaf.setViewState instead. */
  setViewData(data: string, _clear?: boolean): void {
    this.editor.setValue(data);
  }

  /** R147: Obsidian `MarkdownView.showSearch(replace)` — open the editor's find
   *  (or find&replace) panel. Delegates to CM's openSearchPanel (the R34 search
   *  mechanism). The replace-field focus mirrors features/editor `focusReplaceField`
   *  inline — compat cannot import features (layering), a forced 5-line dup. */
  showSearch(replace?: boolean): void {
    const view = this.editor.cm;
    openSearchPanel(view);
    if (replace) {
      requestAnimationFrame(() => {
        const el = view.dom.querySelector<HTMLInputElement>('.cm-search [name="replace"]');
        el?.focus();
        el?.select();
      });
    }
  }
}

/**
 * Build a MarkdownView over the focused editor view, or null. Callers pass
 * their own leaf when they have one; otherwise a fresh active-pane facade
 * leaf is created.
 */
export function makeActiveMarkdownView(
  handle: Handle,
  registry: FileRegistry,
  leaf?: WorkspaceLeaf,
): MarkdownView | null {
  const active = handle.documents.getActiveView();
  if (!active) return null;
  return new MarkdownView(
    leaf ?? new WorkspaceLeaf(handle, registry, false),
    new Editor(active.view),
    registry.getFile(active.path),
  );
}

function wantsNewTab(newLeaf?: PaneType | boolean): boolean {
  return newLeaf === true || newLeaf === "tab" || newLeaf === "split" || newLeaf === "window";
}

/** Minimal WorkspaceLeaf facade over the ACTIVE Geode pane. */
export class WorkspaceLeaf {
  /** @internal compat App shim — View's constructor reads it (this.app). */
  _app?: App;

  constructor(
    protected handle: Handle,
    protected registry: FileRegistry,
    protected newTab: boolean,
  ) {}

  get view(): MarkdownView | View | null {
    return makeActiveMarkdownView(this.handle, this.registry, this);
  }

  async openFile(
    file: TFile,
    openState?: { mode?: string; state?: { mode?: string; source?: boolean } },
  ): Promise<void> {
    this.handle.workspace.openFile(file.path, { newTab: this.newTab });
    // F10: honor an explicit source/preview mode (live stays the default)
    applyViewStateMode(this.handle, openState?.state?.mode ?? openState?.mode, openState?.state?.source);
  }

  getViewState(): { type: string } {
    const tab = findActiveTab(this.handle.workspace.state.get());
    return { type: tab ? tab.viewType : "empty" };
  }

  /**
   * Active-pane facade: a markdown state opens its file (and applies any mode), and a mode-ONLY state
   * (no file) switches the open tab's mode — Obsidian's programmatic mode switch (R137). Custom view
   * types belong on SidebarViewLeaf (below), so anything else is a recorded no-op.
   */
  async setViewState(state: {
    type?: string;
    active?: boolean;
    state?: { file?: string; mode?: string; source?: boolean };
  }): Promise<void> {
    const s = state?.state;
    if (state?.type === "markdown" && typeof s?.file === "string") {
      this.handle.workspace.openFile(s.file, { newTab: this.newTab });
      applyViewStateMode(this.handle, s.mode, s.source); // R137: honor a mode given alongside the file
      return;
    }
    // R137: a mode-only markdown state switches the already-open tab (reading ↔ source ↔ live)
    if (state?.type === "markdown" && (s?.mode === "source" || s?.mode === "preview")) {
      applyViewStateMode(this.handle, s.mode, s.source);
      return;
    }
    reportGap("WorkspaceLeaf", "setViewState", `view type "${state?.type ?? "?"}" not mounted`);
  }

  getDisplayText(): string {
    return findActiveTab(this.handle.workspace.state.get())?.title ?? "";
  }

  detach(): void {
    const tab = findActiveTab(this.handle.workspace.state.get());
    if (tab) this.handle.workspace.closeTab(tab.id);
  }

  /** R146: pin/unpin the tab this leaf represents (the active tab — same facade
   *  semantics as getViewState/getDisplayText/detach). Reuses the R39 tab-pin. */
  togglePinned(): void {
    const tab = findActiveTab(this.handle.workspace.state.get());
    if (tab) this.handle.workspace.toggleTabPin(tab.id);
  }

  /** R146: set the pin state to a specific value (idempotent — toggles only when
   *  the current state differs, so setPinned(true) twice stays pinned). */
  setPinned(pinned: boolean): void {
    const tab = findActiveTab(this.handle.workspace.state.get());
    if (tab && !!tab.pinned !== pinned) this.handle.workspace.toggleTabPin(tab.id);
  }
}

/**
 * A REAL leaf for sidebar custom views (registerView). setViewState mounts
 * the registered View into a Geode sidebar panel; detach tears it down.
 * Same class hierarchy as the active-pane facade so ViewCreator typing holds
 * (the suite never does `instanceof WorkspaceLeaf` checks).
 */
export class SidebarViewLeaf extends WorkspaceLeaf {
  /** @internal sidebar panel id while mounted — "obsidian:view:<type>" */
  _panelId: string | null = null;
  private mountedView: View | null = null;
  private panelDispose: (() => void) | null = null;

  constructor(
    private ws: Workspace,
    handle: Handle,
    registry: FileRegistry,
    readonly side: "left" | "right",
  ) {
    super(handle, registry, true);
    if (ws._app) this._app = ws._app;
  }

  override get view(): View | null {
    return this.mountedView;
  }

  /**
   * Mount the registered view for `type`: creator(leaf) -> load() -> wrap
   * containerEl -> addSidebarPanel -> await onOpen(). Unregistered types are
   * a recorded no-op (gap report).
   */
  override async setViewState(state: { type?: string; active?: boolean; state?: { file?: string } }): Promise<void> {
    const type = state?.type;
    const entry = type ? this.ws._viewRegistry.get(type) : undefined;
    if (!type || !entry) {
      reportGap("WorkspaceLeaf", "setViewState", `view type "${type ?? "?"}" is not registered`);
      return;
    }
    const app = this.ws._app;
    if (!app) {
      reportGap("WorkspaceLeaf", "setViewState", "compat App not wired — cannot mount views");
      return;
    }
    this.detach(); // tear down any currently mounted view first
    // F1/F11: clear stale leaves of the same type (panel-id collision zombies);
    // this leaf is already out of _sideLeaves after detach(), so no re-entry.
    this.ws.detachLeavesOfType(type);
    const view = entry.creator(this);
    this.mountedView = view;
    view.load();
    const wrapper = document.createElement("div");
    wrapper.className = "geode-compat-view-panel";
    wrapper.appendChild(view.containerEl);
    this._panelId = `obsidian:view:${type}`;
    this.panelDispose = app._geode.plugins.addSidebarPanel({
      id: this._panelId,
      side: this.side,
      title: view.getDisplayText(),
      iconSvg: getIconSvg(view.getIcon()) ?? undefined,
      el: wrapper,
    });
    this.ws._sideLeaves.add(this);
    try {
      // onOpen is protected in the official d.ts — host-only cast
      await (view as unknown as { onOpen(): Promise<void> }).onOpen();
    } catch (err) {
      // F2/F18: a throwing onOpen must not leak a half-mounted panel or
      // propagate to the caller (symmetric with detach's onClose guard)
      console.error("[obsidian-compat] view onOpen threw", err);
      reportGap("WorkspaceLeaf", "setViewState", `view "${type}" onOpen failed — leaf detached`);
      this.detach();
      return;
    }
    if (state.active) await this.ws.revealLeaf(this);
  }

  /** Unmount: fire-and-forget onClose, unload, drop the panel. Idempotent. */
  override detach(): void {
    const view = this.mountedView;
    if (!view) return;
    this.mountedView = null;
    this._panelId = null;
    try {
      // onClose is protected in the official d.ts — host-only cast
      void Promise.resolve(
        (view as unknown as { onClose(): Promise<void> }).onClose(),
      ).catch((err) => console.error("[obsidian-compat] view onClose threw", err));
    } catch (err) {
      console.error("[obsidian-compat] view onClose threw", err);
    }
    try {
      view.unload();
    } catch (err) {
      console.error("[obsidian-compat] view unload threw", err);
    }
    this.panelDispose?.();
    this.panelDispose = null;
    this.ws._sideLeaves.delete(this);
  }

  override getViewState(): { type: string } {
    return { type: this.mountedView?.getViewType() ?? "empty" };
  }

  override getDisplayText(): string {
    return this.mountedView?.getDisplayText() ?? "";
  }

  /** R146: a sidebar-view leaf is not a pinnable main-area tab — no-op (the base
   *  methods would findActiveTab in the editor area and pin an unrelated tab).
   *  Mirrors how this subclass overrides every other findActiveTab-based method. */
  override togglePinned(): void {}
  override setPinned(_pinned: boolean): void {}

  getIcon(): string {
    return this.mountedView?.getIcon() ?? "";
  }

  override async openFile(
    file: TFile,
    openState?: { mode?: string; state?: { mode?: string; source?: boolean } },
  ): Promise<void> {
    this.handle.workspace.openFile(file.path, { newTab: false });
    // F10: honor an explicit source/preview mode (live stays the default)
    applyViewStateMode(this.handle, openState?.state?.mode ?? openState?.mode, openState?.state?.source);
  }
}

export class Workspace extends Events {
  /**
   * false while the loader runs the plugin loop — onLayoutReady callbacks
   * queue and flush AFTER the startup vault 'create' replay, mirroring
   * Obsidian's startup (onLayoutReady is the documented replay opt-out).
   */
  layoutReady = false;
  private _layoutReadyQueue: Array<() => unknown> = [];
  activeLeaf: WorkspaceLeaf | null;
  /** @internal MRU fallback for getActiveFile (graph tab focused etc.) */
  _lastFilePath: string | null = null;
  /** @internal registerView registry (plugin.ts writes, side leaves read) */
  _viewRegistry = new Map<string, { creator: ViewCreator; pluginId: string }>();
  /** @internal every sidebar leaf with a mounted view */
  _sideLeaves = new Set<SidebarViewLeaf>();
  /** @internal compat App shim, injected by context.ts right after App is built */
  _app: App | null = null;

  constructor(
    private handle: Handle,
    private registry: FileRegistry,
  ) {
    super();
    this.activeLeaf = new WorkspaceLeaf(handle, registry, false);
  }

  /**
   * @internal context wiring: the App shim is constructed AFTER Workspace, so
   * the bridge (App._geode.plugins for addSidebarPanel) and leaf._app (View's
   * constructor reads it) are injected here.
   */
  _setApp(app: App): void {
    this._app = app;
    if (this.activeLeaf) this.activeLeaf._app = app;
  }

  /** Active-pane facade carrying the compat App reference. */
  private makePaneLeaf(newTab: boolean): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf(this.handle, this.registry, newTab);
    if (this._app) leaf._app = this._app;
    return leaf;
  }

  /** Active file, falling back to the most recently active file. */
  getActiveFile(): TFile | null {
    const path = this.handle.workspace.getActiveFile() ?? this._lastFilePath;
    return path ? this.registry.getFile(path) : null;
  }

  /** 'Runs the callback right away if layout is already ready' — else queued. */
  onLayoutReady(callback: () => unknown): void {
    if (!this.layoutReady) {
      this._layoutReadyQueue.push(callback);
      return;
    }
    try {
      callback();
    } catch (err) {
      console.error("[obsidian-compat] onLayoutReady callback threw", err);
    }
  }

  /**
   * @internal loader: mark layout ready, flush the queued callbacks, then
   * fire the LEGACY "layout-ready" event (calendar's startup path).
   */
  _flushLayoutReady(): void {
    this.layoutReady = true;
    for (const cb of this._layoutReadyQueue.splice(0)) {
      try {
        cb();
      } catch (err) {
        console.error("[obsidian-compat] onLayoutReady callback threw", err);
      }
    }
    this.trigger("layout-ready");
  }

  getLeaf(newLeaf?: "split", direction?: SplitDirection): WorkspaceLeaf;
  getLeaf(newLeaf?: PaneType | boolean): WorkspaceLeaf;
  getLeaf(newLeaf?: PaneType | boolean, _direction?: SplitDirection): WorkspaceLeaf {
    return this.makePaneLeaf(wantsNewTab(newLeaf));
  }

  /**
   * Mounted sidebar leaves of `viewType`. Built-in host types ("markdown"
   * etc.) never live in _sideLeaves, so they keep returning [] — recorded
   * deviation (the suite only queries its own custom types).
   */
  getLeavesOfType(viewType: string): WorkspaceLeaf[] {
    return [...this._sideLeaves].filter((l) => l.view?.getViewType() === viewType);
  }

  /**
   * ALWAYS a fresh non-null leaf — calendar chains
   * getRightLeaf(false).setViewState(...) without a null check.
   */
  getRightLeaf(_split: boolean): SidebarViewLeaf {
    return new SidebarViewLeaf(this, this.handle, this.registry, "right");
  }

  getLeftLeaf(_split: boolean): SidebarViewLeaf {
    return new SidebarViewLeaf(this, this.handle, this.registry, "left");
  }

  /**
   * 'Bring a given leaf to the foreground.' Mounted sidebar leaf -> select
   * its panel (setLeftPanel/setRightPanel also opens the sidebar); other
   * leaves are a resolved no-op.
   */
  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (leaf instanceof SidebarViewLeaf && leaf._panelId) {
      if (leaf.side === "left") this.handle.workspace.setLeftPanel(leaf._panelId);
      else this.handle.workspace.setRightPanel(leaf._panelId);
    }
  }

  /**
   * 'Get the most recently active leaf in a given workspace root' (d.ts:7953).
   * Geode exposes a single active-pane facade (activeLeaf) rather than a real
   * leaf tree, so we return it. `root` (a WorkspaceParent to scope the search)
   * is meaningless without a multi-root split — ignored (recorded deviation).
   */
  getMostRecentLeaf(_root?: unknown): WorkspaceLeaf | null {
    return this.activeLeaf;
  }

  /**
   * 'Sets the active leaf' (d.ts:7922). A mounted sidebar leaf is brought to the
   * foreground via the same path as revealLeaf (the only addressable leaves in
   * the facade). Other leaves carry no pane id under the active-pane facade, so
   * there is no main-area focus to retarget → no-op (recorded deviation). The
   * `focus` param has no separately-focusable surface here, so it is ignored.
   */
  setActiveLeaf(leaf: WorkspaceLeaf, _params?: { focus?: boolean }): void {
    if (leaf instanceof SidebarViewLeaf && leaf._panelId) {
      if (leaf.side === "left") this.handle.workspace.setLeftPanel(leaf._panelId);
      else this.handle.workspace.setRightPanel(leaf._panelId);
    }
  }

  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => unknown): void {
    if (this.activeLeaf) callback(this.activeLeaf);
    for (const leaf of this._sideLeaves) callback(leaf);
  }

  getActiveViewOfType<T>(type: new (...args: never[]) => T): T | null {
    const view = makeActiveMarkdownView(this.handle, this.registry, this.makePaneLeaf(false));
    if (view && view instanceof (type as unknown as new (...args: never[]) => object)) {
      return view as unknown as T;
    }
    return null;
  }

  /**
   * R117: Obsidian `Workspace.activeEditor: MarkdownFileInfo | null` — the active markdown
   * editor's info (a compat MarkdownView IS a MarkdownFileInfo: it carries `editor` + `file`
   * + `app`). The modern API plugins prefer over `getActiveViewOfType(MarkdownView)`. Live
   * getter; null in reading view / when no editor is active (Geode reading view is not
   * CM-backed → getActiveView is null, same divergence as R116).
   */
  get activeEditor(): MarkdownView | null {
    return makeActiveMarkdownView(this.handle, this.registry, this.makePaneLeaf(false));
  }

  /**
   * Resolve + open a wikilink linktext. Unresolved links create the note
   * (vault root) like real Obsidian, then open it.
   */
  async openLinkText(
    linktext: string,
    sourcePath: string,
    newLeaf?: PaneType | boolean,
    openViewState?: OpenViewState,
  ): Promise<void> {
    // parseLinktext keeps the leading "#"/"^" on subpath (faithful to Obsidian's
    // substr split); the path half drives resolution + open, the subpath half the
    // post-open reveal. Strip any alias first ([[note#H|Alias]] ⇒ "note#H").
    const { path: linkpath, subpath } = parseLinktext(linktext.split("|")[0]);
    const bareLink = linkpath.trim();
    if (!bareLink) return;
    let path = this.handle.metadata.resolveLink(bareLink, sourcePath);
    if (!path) {
      const candidates = [`${bareLink}.md`];
      if (bareLink.includes("/")) candidates.push(`${bareLink.split("/").pop()}.md`);
      for (const candidate of candidates) {
        try {
          await this.handle.vault.create(candidate, "");
          path = candidate;
          break;
        } catch {
          /* folder missing / already exists — try the next candidate */
        }
      }
      if (!path) {
        console.error(`[obsidian-compat] openLinkText could not create "${bareLink}.md"`);
        return;
      }
    }
    this.handle.workspace.openFile(path, { newTab: wantsNewTab(newLeaf) });
    // Subpath reveal AFTER openFile so the target pane already holds `path` (R14),
    // mirroring features/editor/wikilinks. parseLinktext keeps the leading "#" so
    // we drop it before resolveSubpath, which expects "^id" (block) or bare heading
    // text; a "#^id" link slices to "^id", a "#Heading" link to "Heading".
    // A freshly created (empty) note resolves to null ⇒ no reveal (the `if (span)`
    // guard), so the create branch never scroll-jumps. openViewState's eState may
    // also carry a subpath/line, but v1 only honours the linktext subpath; other
    // OpenViewState fields (state.mode, active, group) are not consumed here.
    if (subpath) {
      const span = this.handle.metadata.resolveSubpath(path, subpath.slice(1));
      if (span) this.handle.workspace.requestReveal(path, span.from, span.to);
    }
  }

  /** 'Remove all leaves of the given type.' */
  detachLeavesOfType(viewType: string): void {
    for (const leaf of [...this._sideLeaves]) {
      if (leaf.view?.getViewType() === viewType) leaf.detach();
    }
  }

  /** Existing mounted leaf for `type`, or create one on `side` and mount. */
  async ensureSideLeaf(
    type: string,
    side: "left" | "right",
    opts?: { reveal?: boolean },
  ): Promise<WorkspaceLeaf> {
    let leaf = [...this._sideLeaves].find((l) => l.view?.getViewType() === type);
    if (!leaf) {
      leaf = side === "left" ? this.getLeftLeaf(false) : this.getRightLeaf(false);
      await leaf.setViewState({ type });
    }
    if (opts?.reveal) await this.revealLeaf(leaf);
    return leaf;
  }

  /** @deprecated legacy API (calendar) — splits the active pane, returns a facade. */
  splitActiveLeaf(_direction?: SplitDirection): WorkspaceLeaf {
    this.handle.workspace.splitActivePane("row");
    return this.makePaneLeaf(false);
  }

  /** @deprecated legacy API (calendar) — the active-pane facade. */
  getUnpinnedLeaf(): WorkspaceLeaf {
    return this.makePaneLeaf(false);
  }

  /* ----- typed event overloads ----- */

  on(name: "file-open", callback: (file: TFile | null) => unknown, ctx?: unknown): EventRef;
  on(
    name: "active-leaf-change",
    callback: (leaf: WorkspaceLeaf | null) => unknown,
    ctx?: unknown,
  ): EventRef;
  on(name: "layout-change", callback: () => unknown, ctx?: unknown): EventRef;
  on(
    name: "editor-change",
    callback: (editor: Editor, info: MarkdownView) => unknown,
    ctx?: unknown,
  ): EventRef;
  /** R130: a file/folder context menu is opening — add items via `menu.addItem(...)`. The host
   *  collects them (CollectorMenu) and renders them into its native menu. `file` is the TFile or
   *  TFolder; `source` identifies the menu (e.g. "file-explorer-context-menu"). */
  on(
    name: "file-menu",
    callback: (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => unknown,
    ctx?: unknown,
  ): EventRef;
  /** R139: a MULTI-file context menu is opening (right-click on a file-explorer multi-selection) —
   *  add items via `menu.addItem(...)` to act on all `files`. Mirrors file-menu but with an array. */
  on(
    name: "files-menu",
    callback: (menu: Menu, files: TAbstractFile[], source: string, leaf?: WorkspaceLeaf) => unknown,
    ctx?: unknown,
  ): EventRef;
  /** R131 + R200: an editor right-click context menu is opening — add items via `menu.addItem(...)`.
   *  Geode always shows the styled menu with native Cut/Copy/Paste; plugin items are appended below a
   *  separator. `info` is the active MarkdownView. */
  on(
    name: "editor-menu",
    callback: (menu: Menu, editor: Editor, info: MarkdownView) => unknown,
    ctx?: unknown,
  ): EventRef;
  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef;
  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef {
    return super.on(name, callback, ctx);
  }
}
