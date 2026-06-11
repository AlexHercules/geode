import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Random note — jump to a random markdown file in the vault. Great for
 * resurfacing old notes (Obsidian's "Random note" core plugin).
 */
export const randomNotePlugin: GeodePlugin = {
  id: "random-note",
  name: "Random note",
  description: "Open a random markdown note from the vault via the command palette.",
  version: "1.0.0",

  onload(app: AppHandle) {
    // commands.register via the plugin handle auto-tracks the disposer
    app.commands.register({
      id: "random-note:open",
      name: () => t("cmd.randomNote"),
      callback: () => {
        const files = app.vault.getMarkdownFiles();
        if (files.length === 0) return;
        const pick = files[Math.floor(Math.random() * files.length)];
        app.workspace.openFile(pick.path);
      },
    });
  },
};
