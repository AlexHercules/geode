import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Workspaces - save and load workspace layouts (Obsidian's "Workspaces" core
 * plugin). R296: wired as a real builtin plugin per the R294 toggle contract.
 * This plugin owns the "Manage workspaces" command (opens the workspaces modal);
 * disabling auto-disposes it. Other workspace:* commands (toggle-stacked-tabs /
 * copy-url / edit-file-title) are general tab/file operations, NOT workspaces-
 * feature entry points, so they stay in App.tsx ungated.
 */
export const workspacesPlugin: GeodePlugin = {
  id: "workspaces",
  name: () => t("settings.corePlugin.workspaces"),
  description: () => t("settings.corePlugin.workspacesDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "workspace:manage",
      name: () => t("cmd.manageWorkspaces"),
      callback: () => app.workspace.openModal("workspaces"),
    });
  },
};
