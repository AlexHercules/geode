import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Outline - the right-sidebar panel listing the current note's headings
 * (Obsidian's "Outline" core plugin). R295: wired as a real builtin plugin per
 * the R294 core-plugin toggle contract. The panel component (OutlinePanel) is
 * hosted by the App shell; this plugin owns the "Show outline" / "Open outline"
 * commands and the enable/disable lifecycle that gates the panel tab + render +
 * the main-area singleton view (see ARCHITECTURE.md "Round 295 additions").
 */
export const outlinePlugin: GeodePlugin = {
  id: "outline",
  name: () => t("cmdSource.outline"),
  description: () => t("settings.corePlugin.outlineDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:show-outline",
      name: () => t("cmd.showOutline"),
      callback: () => app.workspace.setRightPanel("outline"),
    });
    app.commands.register({
      id: "outline:open-outline",
      name: () => t("cmd.openOutline"),
      callback: () => app.workspace.openOutline(),
    });
  },
};
