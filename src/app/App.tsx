import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./AppContext";
import { useStore } from "@core/store";
import { MIN_PANE_FRACTION, findTabLeaf } from "@core/workspace";
import type { PaneLeaf, PaneNode, PaneSplit } from "@core/types";
import type { SidebarPanelContribution } from "@core/plugins";
import { Icon } from "./icons";
import { Explorer } from "@features/explorer/Explorer";
import { SearchPanel } from "@features/search/SearchPanel";
import { EditorPane } from "@features/editor/EditorPane";
import { GraphView } from "@features/graph/GraphView";
import { BacklinksPanel } from "@features/backlinks/BacklinksPanel";
import { OutlinePanel } from "@features/outline/OutlinePanel";
import { CommandPalette } from "@features/palette/CommandPalette";
import { QuickSwitcher } from "@features/palette/QuickSwitcher";
import { TemplateSelector } from "@features/palette/TemplateSelector";
import { SettingsModal, requestUpdateAutoCheck } from "@features/settings/SettingsModal";
import { exportActiveNoteHtml, printActiveNote } from "@features/export/export";
import { foldAllInView, toggleFoldAtCursor, unfoldAllInView } from "@features/editor/folding";
import { isTauri } from "@core/vault";
import { expandTemplate, templatePickerMode } from "@core/templates";
import { updateSupported } from "@core/update";
import { t, useI18n } from "@core/i18n";
import { loadObsidianPlugins } from "@compat/obsidian/loader";

const LAST_VAULT_KEY = "geode.lastVaultPath";

/* ---------------- tab drag & drop plumbing ---------------- */

/** MIME type used to mark tab drags so foreign drags (files, text) are ignored. */
const TAB_MIME = "application/geode-tab";

type DropZone = "left" | "right" | "top" | "bottom" | "center";

interface TabDragState {
  draggingTabId: string | null;
  setDraggingTabId: (id: string | null) => void;
}

const TabDragContext = createContext<TabDragState>({
  draggingTabId: null,
  setDraggingTabId: () => {},
});

function isTabDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(TAB_MIME);
}

/** Map a pointer position inside an element to one of the 5 drop zones (25% edge bands). */
function zoneFromEvent(e: React.DragEvent<HTMLElement>): DropZone {
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / Math.max(r.width, 1);
  const y = (e.clientY - r.top) / Math.max(r.height, 1);
  if (x < 0.25) return "left";
  if (x > 0.75) return "right";
  if (y < 0.25) return "top";
  if (y > 0.75) return "bottom";
  return "center";
}

export function App() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  const tree = useStore(app.vault.tree);
  const statusItems = useStore(app.plugins.statusBarItems);
  const statusBarElements = useStore(app.plugins.statusBarElements);
  const ribbonItems = useStore(app.plugins.ribbonItems);
  const sidebarPanels = useStore(app.plugins.sidebarPanels);

  /* plugin-contributed sidebar panels (compat registerView custom views) */
  const leftPanels = sidebarPanels.filter((p) => p.side === "left");
  const rightPanels = sidebarPanels.filter((p) => p.side === "right");
  /* an unknown persisted id (e.g. the panel unregistered) falls back to the
     default panel WITHOUT mutating workspace state, so a panel that registers
     later wins again */
  const activeLeftPanel = leftPanels.find((p) => p.id === ws.leftPanel) ?? null;
  const activeRightPanel = rightPanels.find((p) => p.id === ws.rightPanel) ?? null;
  /* effective panel ids AFTER fallback — selection highlights must agree with
     what is actually rendered, even when the persisted id is stale */
  const effectiveLeft = activeLeftPanel
    ? activeLeftPanel.id
    : ws.leftPanel === "search"
      ? "search"
      : "explorer";
  const effectiveRight = activeRightPanel
    ? activeRightPanel.id
    : ws.rightPanel === "outline"
      ? "outline"
      : "backlinks";

  /* tab drag state shared by every TabBar / pane drop overlay */
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const tabDrag = useMemo<TabDragState>(() => ({ draggingTabId, setDraggingTabId }), [draggingTabId]);

  /* if the dragged tab vanishes mid-drag (e.g. its file was deleted), dragend never
     fires on the removed element — clear the state so the drop overlay unmounts */
  useEffect(() => {
    if (draggingTabId !== null && findTabLeaf(ws.root, draggingTabId) === null) {
      setDraggingTabId(null);
    }
  }, [draggingTabId, ws.root]);

  /* ---- register core commands once ---- */
  useEffect(() => {
    const { workspace, vault, commands } = app;
    const disposers = [
      commands.register({
        id: "app:command-palette",
        name: () => t("cmd.commandPalette"),
        hotkey: "Ctrl+P",
        callback: () => workspace.openModal("palette"),
      }),
      commands.register({
        id: "app:quick-switcher",
        name: () => t("cmd.quickSwitcher"),
        hotkey: "Ctrl+O",
        callback: () => workspace.openModal("switcher"),
      }),
      commands.register({
        id: "app:new-note",
        name: () => t("cmd.newNote"),
        hotkey: "Ctrl+N",
        callback: () => {
          void (async () => {
            const path = vault.uniquePath("", "Untitled");
            await vault.create(path, "");
            workspace.openFile(path);
          })();
        },
      }),
      commands.register({
        id: "app:toggle-mode",
        name: () => t("cmd.toggleMode"),
        hotkey: "Ctrl+E",
        callback: () => workspace.toggleActiveTabMode(),
      }),
      commands.register({
        id: "app:toggle-source",
        name: () => t("cmd.toggleSource"),
        hotkey: "Ctrl+Shift+E",
        callback: () => workspace.toggleActiveSourceMode(),
      }),
      commands.register({
        id: "app:reload-plugins",
        name: () => t("cmd.reloadPlugins"),
        callback: () =>
          void (async () => {
            // sequential: external first, then the Obsidian compat layer
            await app.plugins.loadExternal(vault);
            await loadObsidianPlugins(app, vault);
          })(),
      }),
      commands.register({
        id: "app:open-graph",
        name: () => t("cmd.openGraph"),
        hotkey: "Ctrl+G",
        callback: () => workspace.openGraph(),
      }),
      commands.register({
        id: "app:toggle-theme",
        name: () => t("cmd.toggleTheme"),
        callback: () => workspace.toggleTheme(),
      }),
      commands.register({
        id: "app:open-settings",
        name: () => t("cmd.openSettings"),
        hotkey: "Ctrl+,",
        callback: () => workspace.openModal("settings"),
      }),
      commands.register({
        id: "app:toggle-left-sidebar",
        name: () => t("cmd.toggleLeftSidebar"),
        callback: () => workspace.toggleLeftSidebar(),
      }),
      commands.register({
        id: "app:toggle-right-sidebar",
        name: () => t("cmd.toggleRightSidebar"),
        callback: () => workspace.toggleRightSidebar(),
      }),
      commands.register({
        id: "app:close-tab",
        name: () => t("cmd.closeTab"),
        hotkey: "Ctrl+W",
        callback: () => {
          const tab = workspace.getActiveTab();
          if (tab) workspace.closeTab(tab.id);
        },
      }),
      commands.register({
        id: "app:split-right",
        name: () => t("cmd.splitRight"),
        hotkey: "Ctrl+\\",
        callback: () => void workspace.splitActivePane("row"),
      }),
      commands.register({
        id: "app:split-down",
        name: () => t("cmd.splitDown"),
        hotkey: "Ctrl+Shift+\\",
        callback: () => void workspace.splitActivePane("column"),
      }),
      commands.register({
        id: "app:focus-next-pane",
        name: () => t("cmd.focusNextPane"),
        hotkey: "Ctrl+Alt+ArrowRight",
        callback: () => workspace.focusAdjacentPane(1),
      }),
      commands.register({
        id: "app:focus-previous-pane",
        name: () => t("cmd.focusPreviousPane"),
        hotkey: "Ctrl+Alt+ArrowLeft",
        callback: () => workspace.focusAdjacentPane(-1),
      }),
      commands.register({
        id: "editor:toggle-fold",
        name: () => t("cmd.toggleFold"),
        callback: () => {
          const active = app.documents.getActiveView();
          if (active) toggleFoldAtCursor(active.view);
        },
      }),
      commands.register({
        id: "editor:fold-all",
        name: () => t("cmd.foldAll"),
        callback: () => {
          const active = app.documents.getActiveView();
          if (active) foldAllInView(active.view);
        },
      }),
      commands.register({
        id: "editor:unfold-all",
        name: () => t("cmd.unfoldAll"),
        callback: () => {
          const active = app.documents.getActiveView();
          if (active) unfoldAllInView(active.view);
        },
      }),
      commands.register({
        id: "editor:add-property",
        name: () => t("cmd.addProperty"),
        hotkey: "Ctrl+;",
        callback: () => {
          // no file in the active tab → no-op (contract)
          const tab = workspace.getActiveTab();
          if (!tab || !tab.filePath) return;
          // source mode has no panel — flip to live first (contract); a
          // hidden/source DISPLAY setting also has no panel — the command is
          // an explicit edit intent, so flip the setting to visible too
          // (R22 review fix INT-2: otherwise the request hangs unconsumed)
          if (tab.mode === "source") workspace.setTabMode(tab.id, "live");
          if (workspace.propertiesInDocument.get() !== "visible") {
            workspace.setPropertiesInDocument("visible");
          }
          // one-shot request (revealTarget shape): the matching panel may not
          // be MOUNTED yet when the mode just flipped — it consumes the
          // request after mount, creates an empty frontmatter block when
          // missing and focuses the add-name input
          workspace.requestAddProperty(tab.id, tab.filePath);
        },
      }),
      commands.register({
        id: "editor:insert-template",
        name: () => t("cmd.insertTemplate"),
        available: () => workspace.getActiveTab()?.filePath != null,
        callback: () => {
          const tab = workspace.getActiveTab();
          if (!tab || !tab.filePath) return;
          // reading view has no cursor — flip to an editable mode first
          // (add-property precedent, contract)
          if (tab.mode === "preview") workspace.setTabMode(tab.id, "live");
          // one-shot mode handoff: set BEFORE opening, the modal reads on mount
          templatePickerMode.set("insert");
          workspace.openModal("templates");
        },
      }),
      commands.register({
        id: "app:new-note-from-template",
        name: () => t("cmd.newNoteFromTemplate"),
        callback: () => {
          templatePickerMode.set("create");
          workspace.openModal("templates");
        },
      }),
      commands.register({
        id: "editor:insert-date",
        name: () => t("cmd.insertDate"),
        available: () => getActiveFileEditorView(app) !== null,
        callback: () => insertNowAtSelection(app, "{{date}}"),
      }),
      commands.register({
        id: "editor:insert-time",
        name: () => t("cmd.insertTime"),
        available: () => getActiveFileEditorView(app) !== null,
        callback: () => insertNowAtSelection(app, "{{time}}"),
      }),
      commands.register({
        id: "app:export-html",
        name: () => t("cmd.exportHtml"),
        callback: () => void exportActiveNoteHtml(app),
        available: () => workspace.getActiveFile() !== null,
      }),
      commands.register({
        id: "app:export-pdf",
        name: () => t("cmd.exportPdf"),
        callback: () => void printActiveNote(app),
        available: () => workspace.getActiveFile() !== null,
      }),
      commands.register({
        id: "app:check-updates",
        name: () => t("cmd.checkUpdates"),
        available: () => updateSupported(),
        callback: () => {
          // flag first: the settings modal reads it on mount to land on the
          // About section and run one update check automatically
          requestUpdateAutoCheck();
          workspace.openModal("settings");
        },
      }),
    ];
    if (isTauri()) {
      disposers.push(
        commands.register({
          id: "app:open-vault",
          name: () => t("cmd.openVault"),
          callback: () => void openVaultFlow(app),
        }),
      );
    }
    return () => disposers.forEach((d) => d());
  }, [app]);

  /* ---- flush pending editor saves on close ---- */
  useEffect(() => {
    const flush = () => void app.workspace.flushAll();
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);

    let disposed = false;
    let unlistenClose: (() => void) | null = null;
    if (isTauri()) {
      // dynamic import so the browser build never loads the Tauri module
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          await app.workspace.flushAll();
          void getCurrentWindow().destroy();
        });
        if (disposed) unlisten();
        else unlistenClose = unlisten;
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      unlistenClose?.();
    };
  }, [app]);

  /* ---- global hotkeys ---- */
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && app.workspace.state.get().modal) {
        app.workspace.closeModal();
        return;
      }
      app.commands.handleKeydown(e);
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [app]);

  /* ---- no vault yet (desktop only) ---- */
  if (!tree) {
    return (
      <div className="app" data-testid="app-root">
        <VaultPicker />
      </div>
    );
  }

  return (
    <div className="app" data-testid="app-root">
      {/* R20: appended "workspace*" classes mirror Obsidian's DOM so community
          theme CSS can target them — resident, additive only (contract) */}
      <div className="app-body workspace">
        {/* ribbon */}
        <nav className="ribbon workspace-ribbon side-dock-ribbon mod-left" aria-label={t("app.ribbonAria")}>
          <RibbonButton
            icon="files"
            title={t("app.ribbonExplorer")}
            active={ws.leftSidebarOpen && effectiveLeft === "explorer"}
            onClick={() =>
              effectiveLeft === "explorer" && ws.leftSidebarOpen
                ? app.workspace.toggleLeftSidebar()
                : app.workspace.setLeftPanel("explorer")
            }
          />
          <RibbonButton
            icon="search"
            title={t("app.ribbonSearch")}
            active={ws.leftSidebarOpen && effectiveLeft === "search"}
            onClick={() =>
              effectiveLeft === "search" && ws.leftSidebarOpen
                ? app.workspace.toggleLeftSidebar()
                : app.workspace.setLeftPanel("search")
            }
          />
          <RibbonButton icon="graph" title={t("app.ribbonGraph")} onClick={() => app.workspace.openGraph()} />
          <RibbonButton
            icon="command"
            title={t("app.ribbonPalette")}
            onClick={() => app.workspace.openModal("palette")}
          />
          {/* plugin-contributed sidebar panels (compat registerView): one selector button each */}
          {leftPanels.map((p) => (
            <button
              key={p.id}
              className={`ribbon-btn${ws.leftSidebarOpen && effectiveLeft === p.id ? " is-active" : ""}`}
              title={p.title}
              aria-label={p.title}
              data-testid={`sidebar-panel-btn-${p.id}`}
              onClick={() =>
                effectiveLeft === p.id && ws.leftSidebarOpen
                  ? app.workspace.toggleLeftSidebar()
                  : app.workspace.setLeftPanel(p.id)
              }
            >
              <SidebarPanelIcon panel={p} />
            </button>
          ))}
          {/* plugin-contributed ribbon icons (compat addRibbonIcon); els own their handlers */}
          <PluginElementHost
            items={ribbonItems}
            elClassName="ribbon-btn"
            testid="plugin-ribbon-items"
          />
          <div className="ribbon-spacer" />
          <RibbonButton
            icon={ws.theme === "dark" ? "sun" : "moon"}
            title={t("app.ribbonTheme")}
            onClick={() => app.workspace.toggleTheme()}
          />
          <RibbonButton icon="settings" title={t("app.ribbonSettings")} onClick={() => app.workspace.openModal("settings")} />
        </nav>

        {/* left sidebar */}
        {ws.leftSidebarOpen && (
          <aside
            className="sidebar sidebar-left workspace-split mod-horizontal mod-left-split"
            style={{ width: ws.leftWidth }}
            data-testid="left-sidebar"
          >
            {activeLeftPanel ? (
              <SidebarPanelHost key={activeLeftPanel.id} panel={activeLeftPanel} />
            ) : ws.leftPanel === "search" ? (
              <SearchPanel />
            ) : (
              <Explorer />
            )}
            <SidebarResizer side="left" />
          </aside>
        )}

        {/* main area: recursive pane tree */}
        <main className="main workspace-split mod-vertical mod-root">
          <TabDragContext.Provider value={tabDrag}>
            <PaneTree node={ws.root} />
          </TabDragContext.Provider>
        </main>

        {/* right sidebar */}
        {ws.rightSidebarOpen && (
          <aside
            className="sidebar sidebar-right workspace-split mod-horizontal mod-right-split"
            style={{ width: ws.rightWidth }}
            data-testid="right-sidebar"
          >
            <SidebarResizer side="right" />
            <div className="right-tabs" role="tablist" aria-label={t("app.rightPanelAria")}>
              <button
                role="tab"
                aria-selected={effectiveRight === "backlinks"}
                className={`right-tab${effectiveRight === "backlinks" ? " is-active" : ""}`}
                title={t("app.tabBacklinks")}
                data-testid="right-tab-backlinks"
                onClick={() => app.workspace.setRightPanel("backlinks")}
              >
                <Icon name="link" size={15} />
              </button>
              <button
                role="tab"
                aria-selected={effectiveRight === "outline"}
                className={`right-tab${effectiveRight === "outline" ? " is-active" : ""}`}
                title={t("app.tabOutline")}
                data-testid="right-tab-outline"
                onClick={() => app.workspace.setRightPanel("outline")}
              >
                <Icon name="list" size={15} />
              </button>
              {/* plugin-contributed sidebar panels (compat registerView): one tab each */}
              {rightPanels.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={effectiveRight === p.id}
                  className={`right-tab${effectiveRight === p.id ? " is-active" : ""}`}
                  title={p.title}
                  data-testid={`sidebar-panel-tab-${p.id}`}
                  onClick={() => app.workspace.setRightPanel(p.id)}
                >
                  <SidebarPanelIcon panel={p} />
                </button>
              ))}
            </div>
            <div className="right-panel-body">
              {activeRightPanel ? (
                <SidebarPanelHost key={activeRightPanel.id} panel={activeRightPanel} />
              ) : ws.rightPanel === "outline" ? (
                <OutlinePanel />
              ) : (
                <BacklinksPanel />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* status bar */}
      <footer className="status-bar" data-testid="status-bar">
        <span className="status-item status-vault">{app.vault.vaultName}</span>
        <span className="status-spacer" />
        {[...statusItems.entries()].map(([id, text]) => (
          <span key={id} className="status-item">
            {text}
          </span>
        ))}
        {/* element-based status bar items (compat addStatusBarItem) */}
        <PluginElementHost
          items={statusBarElements}
          elClassName="status-item"
          testid="plugin-status-bar-items"
        />
      </footer>

      {/* modals */}
      {ws.modal === "palette" && <CommandPalette />}
      {ws.modal === "switcher" && <QuickSwitcher />}
      {ws.modal === "templates" && <TemplateSelector />}
      {ws.modal === "settings" && <SettingsModal />}
    </div>
  );
}

/** The reported active editor view, but only when it belongs to the
 *  workspace-active tab's file. The raw report is a latched field that can go
 *  stale (a background pane's live editor while a preview/graph tab is
 *  active) — writing through it would edit a NON-active file (R23 review
 *  major DS-1). Pre-R23 consumers (fold commands) are non-destructive. */
function getActiveFileEditorView(app: ReturnType<typeof useApp>) {
  const active = app.documents.getActiveView();
  if (!active || active.path !== app.workspace.getActiveFile()) return null;
  return active;
}

/**
 * Insert the formatted current date/time at the active editor's selection
 * (R23 insert-date / insert-time commands). Routing through expandTemplate
 * keeps the format consumption (trim, empty = default) in core/templates —
 * the replaced value is never re-scanned (single pass).
 */
function insertNowAtSelection(
  app: ReturnType<typeof useApp>,
  variable: "{{date}}" | "{{time}}",
): void {
  const active = getActiveFileEditorView(app);
  if (!active) return;
  const insert = expandTemplate(variable, { title: "", now: new Date() });
  const main = active.view.state.selection.main;
  // single transaction: replaces a non-empty selection, cursor lands at the
  // end of the inserted text
  active.view.dispatch({
    changes: { from: main.from, to: main.to, insert },
    selection: { anchor: main.from + insert.length },
  });
}

/* ---------------- pieces ---------------- */

/** Drag handle on the inner edge of a sidebar. */
function SidebarResizer({ side }: { side: "left" | "right" }) {
  const app = useApp();
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? app.workspace.state.get().leftWidth : app.workspace.state.get().rightWidth;
    const onMove = (ev: MouseEvent) => {
      if (ev.buttons === 0) {
        // mouseup happened outside the window — treat as drag end
        cleanup();
        return;
      }
      const dx = ev.clientX - startX;
      app.workspace.setSidebarWidth(side, side === "left" ? startW + dx : startW - dx);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", cleanup);
      window.removeEventListener("blur", cleanup);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", cleanup);
    window.addEventListener("blur", cleanup);
  };
  return (
    <div
      className={`sidebar-resizer sidebar-resizer-${side}`}
      data-testid={`resizer-${side}`}
      onMouseDown={onMouseDown}
    />
  );
}

/**
 * Hosts plugin-owned DOM elements (compat ribbon icons / status bar items).
 * `display: contents` makes each el a direct flex item of the surrounding
 * ribbon/status-bar container, so they pick up the native layout. The els
 * carry their own event handlers — we only append/remove them.
 */
function PluginElementHost({
  items,
  elClassName,
  testid,
}: {
  items: ReadonlyArray<{ id: string; el: HTMLElement }>;
  elClassName: string;
  testid: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    for (const { el } of items) {
      el.classList.add(elClassName);
      host.appendChild(el);
    }
    return () => {
      for (const { el } of items) {
        if (el.parentNode === host) host.removeChild(el);
      }
    };
  }, [items, elClassName]);
  return <div ref={hostRef} style={{ display: "contents" }} data-testid={testid} />;
}

/**
 * Hosts a plugin-owned sidebar panel body (compat registerView custom views).
 * Same append/remove pattern as PluginElementHost; keyed by panel id so a
 * panel switch unmounts the old element before the new one is appended.
 */
function SidebarPanelHost({ panel }: { panel: SidebarPanelContribution }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.appendChild(panel.el);
    return () => {
      if (panel.el.parentNode === host) host.removeChild(panel.el);
    };
  }, [panel]);
  return (
    <div ref={hostRef} className="sidebar-panel-host" data-testid={`sidebar-panel-${panel.id}`} />
  );
}

/**
 * True when the markup parses to exactly one root element and that element is
 * an <svg> (no siblings). Anything else falls back to the letter icon instead
 * of being injected via dangerouslySetInnerHTML.
 */
function isSingleSvgMarkup(markup: string): boolean {
  try {
    const body = new DOMParser().parseFromString(markup, "text/html").body;
    const nodes = Array.from(body.childNodes).filter(
      (n) => !(n.nodeType === Node.TEXT_NODE && !(n.textContent ?? "").trim()),
    );
    const root = nodes[0];
    return nodes.length === 1 && root instanceof Element && root.tagName.toLowerCase() === "svg";
  } catch {
    return false;
  }
}

/** Selector icon for a plugin sidebar panel: raw svg markup, or the title's first letter. */
function SidebarPanelIcon({ panel }: { panel: SidebarPanelContribution }) {
  if (panel.iconSvg && isSingleSvgMarkup(panel.iconSvg)) {
    return (
      <span
        className="sidebar-panel-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: panel.iconSvg }}
      />
    );
  }
  return (
    <span className="sidebar-panel-icon sidebar-panel-icon-fallback" aria-hidden="true">
      {panel.title.charAt(0).toUpperCase()}
    </span>
  );
}

function RibbonButton(props: { icon: string; title: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      className={`ribbon-btn${props.active ? " is-active" : ""}`}
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={20} />
    </button>
  );
}

/** Recursive renderer for the workspace pane tree. */
function PaneTree({ node }: { node: PaneNode }) {
  if (node.kind === "leaf") return <PaneLeafView leaf={node} />;
  return <PaneSplitView split={node} />;
}

function PaneSplitView({ split }: { split: PaneSplit }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={containerRef}
      className={`pane-split pane-split-${split.direction}`}
      data-testid={`pane-split-${split.id}`}
    >
      {split.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <PaneResizer split={split} index={i - 1} containerRef={containerRef} />}
          <div
            className="pane-split-child"
            style={{ flexGrow: split.sizes[i] ?? 1, flexBasis: 0 }}
          >
            <PaneTree node={child} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** Drag handle between two adjacent children of a split. `index` is the gap index (0..n-2). */
function PaneResizer({
  split,
  index,
  containerRef,
}: {
  split: PaneSplit;
  index: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const app = useApp();
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const total = split.direction === "row" ? rect.width : rect.height;
    if (total <= 0) return;
    const start = split.direction === "row" ? e.clientX : e.clientY;
    const startSizes = [...split.sizes];
    const sizeAt = (i: number) => startSizes[i] ?? 1;
    const onMove = (ev: MouseEvent) => {
      if (ev.buttons === 0) {
        // mouseup happened outside the window — treat as drag end
        cleanup();
        return;
      }
      const cur = split.direction === "row" ? ev.clientX : ev.clientY;
      const raw = (cur - start) / total;
      // clamp so both adjacent children stay >= MIN_PANE_FRACTION and their sum is
      // unchanged — untouched siblings are never squeezed
      const min = MIN_PANE_FRACTION - sizeAt(index);
      const max = sizeAt(index + 1) - MIN_PANE_FRACTION;
      const delta = Math.min(Math.max(raw, min), max);
      const sizes = [...startSizes];
      sizes[index] = sizeAt(index) + delta;
      sizes[index + 1] = sizeAt(index + 1) - delta;
      app.workspace.setSplitSizes(split.id, sizes);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", cleanup);
      window.removeEventListener("blur", cleanup);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = split.direction === "row" ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", cleanup);
    window.addEventListener("blur", cleanup);
  };
  return (
    <div
      className={`pane-resizer pane-resizer-${split.direction}`}
      data-testid={`pane-resizer-${split.id}-${index}`}
      onMouseDown={onMouseDown}
    />
  );
}

function PaneLeafView({ leaf }: { leaf: PaneLeaf }) {
  const app = useApp();
  const ws = useStore(app.workspace.state);
  const { draggingTabId, setDraggingTabId } = useContext(TabDragContext);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const isActive = ws.activePaneId === leaf.id;
  const activeTab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? null;

  return (
    <section
      className={`pane${isActive ? " is-active" : ""}`}
      data-testid={`pane-${leaf.id}`}
      data-active={isActive || undefined}
      onMouseDownCapture={() => {
        if (!isActive) app.workspace.setActivePane(leaf.id);
      }}
    >
      <TabBar leaf={leaf} />
      <div className="main-content">
        {activeTab ? (
          activeTab.viewType === "graph" ? (
            <GraphView />
          ) : (
            <EditorPane key={activeTab.id} tab={activeTab} />
          )
        ) : (
          <EmptyState />
        )}
        {/* five-zone drop overlay, mounted only while a tab drag is in flight so it
            sits above the editor and owns the dragover/drop events */}
        {draggingTabId !== null && (
          <div
            className="pane-drop-overlay"
            data-testid="pane-drop-overlay"
            onDragOver={(e) => {
              if (!isTabDrag(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const zone = zoneFromEvent(e);
              setDropZone((prev) => (prev === zone ? prev : zone));
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setDropZone(null);
            }}
            onDrop={(e) => {
              if (!isTabDrag(e)) return;
              e.preventDefault();
              e.stopPropagation();
              const tabId = e.dataTransfer.getData(TAB_MIME);
              const zone = zoneFromEvent(e);
              setDropZone(null);
              setDraggingTabId(null);
              if (!tabId) return;
              if (zone === "center") {
                // dropping a tab onto its own pane's center is a no-op (would
                // otherwise silently reorder it to the end)
                if (findTabLeaf(ws.root, tabId)?.id === leaf.id) return;
                app.workspace.moveTab(tabId, leaf.id);
              } else {
                app.workspace.moveTabToEdge(tabId, leaf.id, zone);
              }
            }}
          >
            {dropZone && <div className={`pane-drop-zone pane-drop-zone-${dropZone}`} />}
          </div>
        )}
      </div>
    </section>
  );
}

function TabBar({ leaf }: { leaf: PaneLeaf }) {
  const app = useApp();
  const t = useI18n();
  const { setDraggingTabId } = useContext(TabDragContext);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  /** Insert index from the pointer x relative to each tab's midpoint. */
  const indexFromEvent = (e: React.DragEvent<HTMLElement>): number => {
    const tabEls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(":scope > .tab"));
    for (let i = 0; i < tabEls.length; i++) {
      const r = tabEls[i]!.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) return i;
    }
    return tabEls.length;
  };

  return (
    <div
      className="tab-bar"
      role="tablist"
      data-testid={`tab-bar-${leaf.id}`}
      onDragOver={(e) => {
        if (!isTabDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const idx = indexFromEvent(e);
        setDropIndex((prev) => (prev === idx ? prev : idx));
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropIndex(null);
      }}
      onDrop={(e) => {
        if (!isTabDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const tabId = e.dataTransfer.getData(TAB_MIME);
        const idx = indexFromEvent(e);
        setDropIndex(null);
        setDraggingTabId(null);
        if (tabId) app.workspace.moveTab(tabId, leaf.id, idx);
      }}
    >
      {leaf.tabs.map((tab, i) => {
        /* the graph tab's stored title is persisted in workspace state —
           ignore it at render time so the label follows the UI locale;
           file tabs keep the basename verbatim */
        const title = tab.viewType === "graph" ? t("app.graphTab") : tab.title;
        return (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === leaf.activeTabId}
          className={`tab${tab.id === leaf.activeTabId ? " is-active" : ""}${
            dropIndex === i ? " tab-drop-before" : ""
          }${dropIndex === leaf.tabs.length && i === leaf.tabs.length - 1 ? " tab-drop-after" : ""}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(TAB_MIME, tab.id);
            e.dataTransfer.effectAllowed = "move";
            // defer so the DOM is not mutated inside dragstart (Chromium cancels the drag)
            window.setTimeout(() => setDraggingTabId(tab.id), 0);
          }}
          onDragEnd={() => setDraggingTabId(null)}
          onClick={() => app.workspace.setActiveTab(tab.id)}
          onAuxClick={(e) => e.button === 1 && app.workspace.closeTab(tab.id)}
          title={tab.filePath ?? title}
        >
          {tab.viewType === "graph" && <Icon name="graph" size={14} />}
          <span className="tab-title">{title}</span>
          <button
            className="tab-close"
            aria-label={t("app.closeTab", { title })}
            onClick={(e) => {
              e.stopPropagation();
              app.workspace.closeTab(tab.id);
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
        );
      })}
      <button
        className="tab-new"
        title={t("app.newNoteTitle")}
        aria-label={t("app.newNote")}
        onClick={() => app.commands.execute("app:new-note")}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function EmptyState() {
  const app = useApp();
  const t = useI18n();
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-state-card">
        <h2>{t("app.emptyTitle")}</h2>
        <div className="empty-actions">
          <button onClick={() => app.commands.execute("app:new-note")}>{t("app.emptyNewNote")}</button>
          <button onClick={() => app.workspace.openModal("switcher")}>{t("app.emptySwitcher")}</button>
          <button onClick={() => app.workspace.openGraph()}>{t("app.emptyGraph")}</button>
        </div>
      </div>
    </div>
  );
}

function VaultPicker() {
  const app = useApp();
  const t = useI18n();
  return (
    <div className="vault-picker" data-testid="vault-picker">
      <div className="vault-picker-card">
        <h1>💎 Geode</h1>
        <p>{t("app.vaultTagline")}</p>
        <button className="btn-accent" onClick={() => void openVaultFlow(app)}>
          {t("app.openVaultButton")}
        </button>
      </div>
    </div>
  );
}

async function openVaultFlow(app: ReturnType<typeof useApp>) {
  const picked = await app.vault.adapter.pickVaultFolder();
  if (!picked) return;
  // Flush pending edits into the OLD vault BEFORE re-pointing the adapter:
  // afterwards relative paths resolve into the new root, and a late save
  // would silently overwrite the new vault's file with old-vault content.
  // (DocumentManager additionally invalidates all handles on vault:changed
  // reason "load" — see DocumentHandle.handleVaultLoad.)
  await app.workspace.flushAll();
  // relative paths from the OLD vault must never anchor the local graph in the
  // new one (same-named files would silently collide)
  app.workspace.lastActiveFile.set(null);
  app.vault.adapter.setVaultPath(picked);
  try {
    localStorage.setItem(LAST_VAULT_KEY, picked);
  } catch {
    /* ignore */
  }
  await app.vault.load();
  // tabs persisted from the previous vault point at files the new vault does
  // not have — close them before plugins reload against the new vault
  app.workspace.closeMissingFileTabs((p) => app.vault.fileExists(p));
  try {
    await app.plugins.loadExternal(app.vault);
  } catch (err) {
    console.error("[vault] external plugin load failed", err);
  }
  try {
    await loadObsidianPlugins(app, app.vault);
  } catch (err) {
    console.error("[vault] obsidian plugin load failed", err);
  }
}

export { LAST_VAULT_KEY };
