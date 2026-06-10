import { useEffect, useMemo } from "react";
import { useApp } from "./AppContext";
import { useStore } from "@core/store";
import { Icon } from "./icons";
import { Explorer } from "@features/explorer/Explorer";
import { SearchPanel } from "@features/search/SearchPanel";
import { EditorPane } from "@features/editor/EditorPane";
import { GraphView } from "@features/graph/GraphView";
import { BacklinksPanel } from "@features/backlinks/BacklinksPanel";
import { OutlinePanel } from "@features/outline/OutlinePanel";
import { CommandPalette } from "@features/palette/CommandPalette";
import { QuickSwitcher } from "@features/palette/QuickSwitcher";
import { SettingsModal } from "@features/settings/SettingsModal";
import { isTauri } from "@core/vault";

const LAST_VAULT_KEY = "geode.lastVaultPath";

export function App() {
  const app = useApp();
  const ws = useStore(app.workspace.state);
  const tree = useStore(app.vault.tree);
  const statusItems = useStore(app.plugins.statusBarItems);

  /* ---- register core commands once ---- */
  useEffect(() => {
    const { workspace, vault, commands } = app;
    const disposers = [
      commands.register({
        id: "app:command-palette",
        name: "Open command palette",
        hotkey: "Ctrl+P",
        callback: () => workspace.openModal("palette"),
      }),
      commands.register({
        id: "app:quick-switcher",
        name: "Quick switcher: open note",
        hotkey: "Ctrl+O",
        callback: () => workspace.openModal("switcher"),
      }),
      commands.register({
        id: "app:new-note",
        name: "Create new note",
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
        name: "Toggle editing / reading view",
        hotkey: "Ctrl+E",
        callback: () => workspace.toggleActiveTabMode(),
      }),
      commands.register({
        id: "app:toggle-source",
        name: "Toggle live preview / source mode",
        hotkey: "Ctrl+Shift+E",
        callback: () => workspace.toggleActiveSourceMode(),
      }),
      commands.register({
        id: "app:reload-plugins",
        name: "Reload external plugins",
        callback: () => void app.plugins.loadExternal(vault),
      }),
      commands.register({
        id: "app:open-graph",
        name: "Open graph view",
        hotkey: "Ctrl+G",
        callback: () => workspace.openGraph(),
      }),
      commands.register({
        id: "app:toggle-theme",
        name: "Toggle dark / light theme",
        callback: () => workspace.toggleTheme(),
      }),
      commands.register({
        id: "app:open-settings",
        name: "Open settings",
        hotkey: "Ctrl+,",
        callback: () => workspace.openModal("settings"),
      }),
      commands.register({
        id: "app:toggle-left-sidebar",
        name: "Toggle left sidebar",
        callback: () => workspace.toggleLeftSidebar(),
      }),
      commands.register({
        id: "app:toggle-right-sidebar",
        name: "Toggle right sidebar",
        callback: () => workspace.toggleRightSidebar(),
      }),
      commands.register({
        id: "app:close-tab",
        name: "Close current tab",
        hotkey: "Ctrl+W",
        callback: () => {
          const tab = workspace.getActiveTab();
          if (tab) workspace.closeTab(tab.id);
        },
      }),
    ];
    if (isTauri()) {
      disposers.push(
        commands.register({
          id: "app:open-vault",
          name: "Open another vault…",
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

  const activeTab = useMemo(
    () => ws.tabs.find((t) => t.id === ws.activeTabId) ?? null,
    [ws.tabs, ws.activeTabId],
  );

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
      <div className="app-body">
        {/* ribbon */}
        <nav className="ribbon" aria-label="Primary">
          <RibbonButton
            icon="files"
            title="File explorer"
            active={ws.leftSidebarOpen && ws.leftPanel === "explorer"}
            onClick={() =>
              ws.leftPanel === "explorer" && ws.leftSidebarOpen
                ? app.workspace.toggleLeftSidebar()
                : app.workspace.setLeftPanel("explorer")
            }
          />
          <RibbonButton
            icon="search"
            title="Search"
            active={ws.leftSidebarOpen && ws.leftPanel === "search"}
            onClick={() =>
              ws.leftPanel === "search" && ws.leftSidebarOpen
                ? app.workspace.toggleLeftSidebar()
                : app.workspace.setLeftPanel("search")
            }
          />
          <RibbonButton icon="graph" title="Graph view (Ctrl+G)" onClick={() => app.workspace.openGraph()} />
          <RibbonButton
            icon="command"
            title="Command palette (Ctrl+P)"
            onClick={() => app.workspace.openModal("palette")}
          />
          <div className="ribbon-spacer" />
          <RibbonButton
            icon={ws.theme === "dark" ? "sun" : "moon"}
            title="Toggle theme"
            onClick={() => app.workspace.toggleTheme()}
          />
          <RibbonButton icon="settings" title="Settings (Ctrl+,)" onClick={() => app.workspace.openModal("settings")} />
        </nav>

        {/* left sidebar */}
        {ws.leftSidebarOpen && (
          <aside
            className="sidebar sidebar-left"
            style={{ width: ws.leftWidth }}
            data-testid="left-sidebar"
          >
            {ws.leftPanel === "explorer" ? <Explorer /> : <SearchPanel />}
            <SidebarResizer side="left" />
          </aside>
        )}

        {/* main area */}
        <main className="main">
          <TabBar />
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
          </div>
        </main>

        {/* right sidebar */}
        {ws.rightSidebarOpen && (
          <aside
            className="sidebar sidebar-right"
            style={{ width: ws.rightWidth }}
            data-testid="right-sidebar"
          >
            <SidebarResizer side="right" />
            <div className="right-tabs" role="tablist" aria-label="Right panel">
              <button
                role="tab"
                aria-selected={ws.rightPanel === "backlinks"}
                className={`right-tab${ws.rightPanel === "backlinks" ? " is-active" : ""}`}
                title="Backlinks"
                data-testid="right-tab-backlinks"
                onClick={() => app.workspace.setRightPanel("backlinks")}
              >
                <Icon name="link" size={15} />
              </button>
              <button
                role="tab"
                aria-selected={ws.rightPanel === "outline"}
                className={`right-tab${ws.rightPanel === "outline" ? " is-active" : ""}`}
                title="Outline"
                data-testid="right-tab-outline"
                onClick={() => app.workspace.setRightPanel("outline")}
              >
                <Icon name="list" size={15} />
              </button>
            </div>
            <div className="right-panel-body">
              {ws.rightPanel === "backlinks" ? <BacklinksPanel /> : <OutlinePanel />}
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
      </footer>

      {/* modals */}
      {ws.modal === "palette" && <CommandPalette />}
      {ws.modal === "switcher" && <QuickSwitcher />}
      {ws.modal === "settings" && <SettingsModal />}
    </div>
  );
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
      const dx = ev.clientX - startX;
      app.workspace.setSidebarWidth(side, side === "left" ? startW + dx : startW - dx);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return (
    <div
      className={`sidebar-resizer sidebar-resizer-${side}`}
      data-testid={`resizer-${side}`}
      onMouseDown={onMouseDown}
    />
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

function TabBar() {
  const app = useApp();
  const ws = useStore(app.workspace.state);
  return (
    <div className="tab-bar" role="tablist" data-testid="tab-bar">
      {ws.tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === ws.activeTabId}
          className={`tab${tab.id === ws.activeTabId ? " is-active" : ""}`}
          onClick={() => app.workspace.setActiveTab(tab.id)}
          onAuxClick={(e) => e.button === 1 && app.workspace.closeTab(tab.id)}
          title={tab.filePath ?? tab.title}
        >
          {tab.viewType === "graph" && <Icon name="graph" size={14} />}
          <span className="tab-title">{tab.title}</span>
          <button
            className="tab-close"
            aria-label={`Close ${tab.title}`}
            onClick={(e) => {
              e.stopPropagation();
              app.workspace.closeTab(tab.id);
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
      <button
        className="tab-new"
        title="New note (Ctrl+N)"
        aria-label="New note"
        onClick={() => app.commands.execute("app:new-note")}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function EmptyState() {
  const app = useApp();
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-state-card">
        <h2>No file is open</h2>
        <div className="empty-actions">
          <button onClick={() => app.commands.execute("app:new-note")}>Create new note (Ctrl+N)</button>
          <button onClick={() => app.workspace.openModal("switcher")}>Open quick switcher (Ctrl+O)</button>
          <button onClick={() => app.workspace.openGraph()}>Open graph view (Ctrl+G)</button>
        </div>
      </div>
    </div>
  );
}

function VaultPicker() {
  const app = useApp();
  return (
    <div className="vault-picker" data-testid="vault-picker">
      <div className="vault-picker-card">
        <h1>💎 Geode</h1>
        <p>Your local-first markdown knowledge base.</p>
        <button className="btn-accent" onClick={() => void openVaultFlow(app)}>
          Open folder as vault
        </button>
      </div>
    </div>
  );
}

async function openVaultFlow(app: ReturnType<typeof useApp>) {
  const picked = await app.vault.adapter.pickVaultFolder();
  if (!picked) return;
  app.vault.adapter.setVaultPath(picked);
  try {
    localStorage.setItem(LAST_VAULT_KEY, picked);
  } catch {
    /* ignore */
  }
  await app.vault.load();
  try {
    await app.plugins.loadExternal(app.vault);
  } catch (err) {
    console.error("[vault] external plugin load failed", err);
  }
}

export { LAST_VAULT_KEY };
