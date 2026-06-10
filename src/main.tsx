import React from "react";
import ReactDOM from "react-dom/client";
import { App, LAST_VAULT_KEY } from "@app/App";
import { AppContext, GeodeApp } from "@app/AppContext";
import { CommandRegistry } from "@core/commands";
import { EventBus } from "@core/events";
import { MetadataIndex } from "@core/metadata";
import { PluginManager } from "@core/plugins";
import { isTauri, MemoryVaultAdapter, TauriVaultAdapter, Vault } from "@core/vault";
import { Workspace } from "@core/workspace";
import { BUILTIN_PLUGINS } from "./plugins";
import "./styles/app.css";

async function bootstrap() {
  const events = new EventBus();
  const adapter = isTauri() ? new TauriVaultAdapter() : new MemoryVaultAdapter();
  const vault = new Vault(adapter, events);
  const metadata = new MetadataIndex(vault, events);
  const workspace = new Workspace(events);
  const commands = new CommandRegistry();
  const plugins = new PluginManager({ vault, metadata, workspace, commands, events });

  const app: GeodeApp = { vault, metadata, workspace, commands, events, plugins };

  workspace.applyDocumentEffects();

  // expose the plugin API for external extension (the "extensibility story")
  (window as unknown as Record<string, unknown>).geode = {
    app,
    registerPlugin: (p: Parameters<PluginManager["register"]>[0]) => plugins.register(p),
  };

  // load vault: memory adapter is always ready; desktop restores the last vault
  if (adapter.kind === "memory") {
    await vault.load();
  } else {
    const last = localStorage.getItem(LAST_VAULT_KEY);
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
    await plugins.register(plugin);
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppContext.Provider value={app}>
        <App />
      </AppContext.Provider>
    </React.StrictMode>,
  );
}

void bootstrap();
