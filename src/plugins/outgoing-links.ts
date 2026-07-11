import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Outgoing links - the right-sidebar panel showing links from the current note
 * plus detected possible links (Obsidian's "Outgoing links" core plugin). R295:
 * wired as a real builtin plugin per the R294 toggle contract. The panel
 * (OutgoingLinksPanel) is hosted by the App shell; this plugin owns the
 * "Show outgoing links" / "Open outgoing links" commands and the lifecycle that
 * gates the panel tab + render + main-area singleton view.
 */
export const outgoingLinksPlugin: GeodePlugin = {
  id: "outgoing-links",
  name: () => t("cmdSource.outgoingLinks"),
  description: () => t("settings.corePlugin.outgoingLinksDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:show-outgoing-links",
      name: () => t("cmd.showOutgoingLinks"),
      callback: () => app.workspace.setRightPanel("outgoinglinks"),
    });
    app.commands.register({
      id: "outgoing-links:open-outgoing-links",
      name: () => t("cmd.openOutgoingLinks"),
      callback: () => app.workspace.openOutgoingLinks(),
    });
  },
};
