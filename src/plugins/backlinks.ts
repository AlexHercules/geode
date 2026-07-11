import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Backlinks - the right-sidebar panel showing links pointing to the current
 * note (Obsidian's "Backlinks" core plugin). R295: wired as a real builtin
 * plugin per the R294 toggle contract. The panel (BacklinksPanel) is hosted by
 * the App shell and is also the DEFAULT right-panel fallback; this plugin owns
 * the "Show backlinks" / "Open backlinks" commands and the lifecycle that gates
 * the panel tab + render + effectiveRight fallback (disabled -> calendar) +
 * main-area singleton view. See ARCHITECTURE.md "Round 295 additions".
 */
export const backlinksPlugin: GeodePlugin = {
  id: "backlinks",
  name: () => t("cmdSource.backlinks"),
  description: () => t("settings.corePlugin.backlinksDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:show-backlinks",
      name: () => t("cmd.showBacklinks"),
      callback: () => app.workspace.setRightPanel("backlinks"),
    });
    app.commands.register({
      id: "backlink:open-backlinks",
      name: () => t("cmd.openBacklinks"),
      callback: () => app.workspace.openBacklinks(),
    });
  },
};
