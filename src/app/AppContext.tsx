import { createContext, useContext } from "react";
import type { ObsidianPluginReport } from "@compat/obsidian/loader";
import { CommandRegistry } from "@core/commands";
import { DocumentManager } from "@core/documents";
import { EventBus } from "@core/events";
import { MetadataIndex } from "@core/metadata";
import { PluginManager } from "@core/plugins";
import { Store } from "@core/store";
import { Vault } from "@core/vault";
import { Workspace } from "@core/workspace";

/** The app singleton bundle — everything a feature module needs. */
export interface GeodeApp {
  vault: Vault;
  metadata: MetadataIndex;
  workspace: Workspace;
  commands: CommandRegistry;
  events: EventBus;
  plugins: PluginManager;
  documents: DocumentManager;
  /**
   * Obsidian compat loader report, handed over by the app layer so feature
   * modules never import @compat directly (layering rule).
   */
  obsidianLoadReport: Store<ReadonlyArray<ObsidianPluginReport>>;
}

export const AppContext = createContext<GeodeApp | null>(null);

export function useApp(): GeodeApp {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp must be used inside <AppContext.Provider>");
  return app;
}
