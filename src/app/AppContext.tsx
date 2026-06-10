import { createContext, useContext } from "react";
import { CommandRegistry } from "@core/commands";
import { EventBus } from "@core/events";
import { MetadataIndex } from "@core/metadata";
import { PluginManager } from "@core/plugins";
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
}

export const AppContext = createContext<GeodeApp | null>(null);

export function useApp(): GeodeApp {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp must be used inside <AppContext.Provider>");
  return app;
}
