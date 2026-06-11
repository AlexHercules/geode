import React from "react";
import ReactDOM from "react-dom/client";
import { App, LAST_VAULT_KEY } from "@app/App";
import { AppContext, GeodeApp } from "@app/AppContext";
import { loadObsidianPlugins, obsidianLoadReport } from "@compat/obsidian/loader";
import { CommandRegistry } from "@core/commands";
import { DocumentManager } from "@core/documents";
import { EventBus } from "@core/events";
import { MetadataIndex } from "@core/metadata";
import { PluginManager } from "@core/plugins";
import { isTauri, MemoryVaultAdapter, TauriVaultAdapter, Vault } from "@core/vault";
import { Workspace } from "@core/workspace";
import { BUILTIN_PLUGINS } from "./plugins";
import "./styles/app.css";

/* ---------------- top-level error boundary ---------------- */

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[geode] render crashed", error, info);
  }

  private clearAndReload = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("geode.")) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
    } catch {
      /* storage unavailable — still reload */
    }
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-testid="app-error"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            height: "100vh",
            padding: "24px",
            textAlign: "center",
            background: "var(--bg-app, #1e1e1e)",
            color: "var(--text-normal, #ddd)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "20px" }}>Something went wrong</h1>
          <p style={{ margin: 0, color: "var(--text-muted, #999)", maxWidth: "48ch" }}>
            Geode hit an unexpected error. Your notes are plain files on disk and are safe.
            Reloading usually fixes it; if it keeps happening, clear the saved state below.
          </p>
          <pre
            style={{
              margin: 0,
              padding: "8px 12px",
              maxWidth: "80ch",
              overflow: "auto",
              fontSize: "12px",
              color: "var(--text-muted, #999)",
              border: "1px solid var(--border, #444)",
              borderRadius: "6px",
            }}
          >
            {this.state.error.message}
          </pre>
          <button onClick={this.clearAndReload}>Clear saved state &amp; reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

async function bootstrap() {
  const events = new EventBus();
  const adapter = isTauri() ? new TauriVaultAdapter() : new MemoryVaultAdapter();
  const vault = new Vault(adapter, events);
  const metadata = new MetadataIndex(vault, events);
  const workspace = new Workspace(events);
  const commands = new CommandRegistry();
  const documents = new DocumentManager(vault, events);
  const plugins = new PluginManager({ vault, metadata, workspace, commands, events, documents });

  const app: GeodeApp = {
    vault,
    metadata,
    workspace,
    commands,
    events,
    plugins,
    documents,
    // app layer hands the compat load report to feature modules (no direct
    // @compat imports below the app layer)
    obsidianLoadReport,
  };

  workspace.applyDocumentEffects();
  // close-time flushing covers every open document (single source of dirty state)
  workspace.registerFlusher(() => documents.flushAll());

  // expose the plugin API for external extension (the "extensibility story")
  (window as unknown as Record<string, unknown>).geode = {
    app,
    registerPlugin: (p: Parameters<PluginManager["register"]>[0]) => plugins.register(p),
  };

  // load vault: memory adapter is always ready; desktop restores the last vault
  if (adapter.kind === "memory") {
    await vault.load();
  } else {
    // CLI takes precedence: `geode.exe <folder>` opens that folder as the vault
    let initial: string | null = null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      initial = (await invoke<string | null>("initial_vault")) ?? null;
    } catch {
      /* command unavailable — fall through to last-vault restore */
    }
    const last = initial ?? localStorage.getItem(LAST_VAULT_KEY);
    if (last) {
      adapter.setVaultPath(last);
      try {
        await vault.load();
      } catch (err) {
        console.warn("[boot] failed to reopen last vault", err);
        localStorage.removeItem(LAST_VAULT_KEY);
      }
    }
  }

  for (const plugin of BUILTIN_PLUGINS) {
    try {
      await plugins.register(plugin);
    } catch (err) {
      console.error(`[boot] failed to register plugin "${plugin.id}"`, err);
    }
  }

  // external plugins from <vault>/.geode/plugins/*.js (desktop, vault open)
  if (vault.isOpen) {
    try {
      await plugins.loadExternal(vault);
    } catch (err) {
      console.error("[boot] external plugin load failed", err);
    }
    // Obsidian community plugins from <vault>/.obsidian/plugins/ (compat layer)
    try {
      await loadObsidianPlugins(app, vault);
    } catch (err) {
      console.error("[boot] obsidian plugin load failed", err);
    }
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppContext.Provider value={app}>
          <App />
        </AppContext.Provider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

bootstrap().catch((err: unknown) => {
  console.error("[boot] bootstrap failed", err);
  const root = document.getElementById("root");
  if (!root) return;
  root.textContent = "";
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.padding = "24px";
  box.style.fontFamily = "system-ui, sans-serif";
  const title = document.createElement("h1");
  title.style.fontSize = "18px";
  title.textContent = "Geode failed to start";
  const detail = document.createElement("pre");
  detail.style.whiteSpace = "pre-wrap";
  detail.textContent = err instanceof Error ? err.message : String(err);
  box.append(title, detail);
  root.appendChild(box);
});
