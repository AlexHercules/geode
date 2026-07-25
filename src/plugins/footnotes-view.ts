import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Footnotes view - the right-sidebar panel listing all footnotes (Obsidian's
 * 1.9 native "Footnotes view" core plugin). R297: wired as a real builtin plugin
 * per the R294 toggle contract. Owns the "Show footnotes" command; disabling
 * auto-disposes it and hides the panel tab + render. The panel (FootnotesPanel)
 * is hosted by the App shell.
 */
export const footnotesViewPlugin: GeodePlugin = {
  id: "footnotes-view",
  name: () => t("settings.corePlugin.footnotesView"),
  description: () => t("settings.corePlugin.footnotesViewDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:show-footnotes",
      name: () => t("cmd.showFootnotes"),
      callback: () => app.workspace.setRightPanel("footnotes"),
    });
  },
};
