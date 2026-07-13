import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * File explorer - the left-sidebar panel showing and managing vault files
 * (Obsidian's "File explorer" core plugin). R296: wired as a real builtin plugin
 * per the R294 toggle contract. The panel (Explorer) is hosted by the App shell
 * and is the DEFAULT left-panel fallback; this plugin owns the "Show file
 * explorer" command and the lifecycle that gates the panel tab + render +
 * effectiveLeft fallback (disabled -> search/bookmarks). General file commands
 * (new-note/rename/delete) stay in App.tsx - they are useful regardless of
 * whether the explorer panel is open. See ARCHITECTURE.md "Round 296 additions".
 */
export const fileExplorerPlugin: GeodePlugin = {
  id: "file-explorer",
  name: () => t("settings.corePlugin.fileExplorer"),
  description: () => t("settings.corePlugin.fileExplorerDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:show-file-explorer",
      name: () => t("cmd.showFileExplorer"),
      callback: () => app.workspace.setLeftPanel("explorer"),
    });
  },
};
