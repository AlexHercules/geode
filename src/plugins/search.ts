import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Search - the left-sidebar panel for searching across all vault files
 * (Obsidian's "Search" core plugin). R296: wired as a real builtin plugin per
 * the R294 toggle contract. The panel (SearchPanel) is hosted by the App shell;
 * this plugin owns the "Search in all files" command (Mod+Shift+F) and the
 * lifecycle that gates the panel tab + render + effectiveLeft.
 */
export const searchPlugin: GeodePlugin = {
  id: "search",
  name: () => t("settings.corePlugin.search"),
  description: () => t("settings.corePlugin.searchDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:show-search",
      name: () => t("cmd.showSearch"),
      hotkey: "Mod+Shift+F",
      callback: () => app.workspace.setLeftPanel("search"),
    });
  },
};
