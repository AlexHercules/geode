import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Bookmarks - bookmark notes, searches, graphs, and headings (Obsidian's
 * "Bookmarks" core plugin). R297: wired as a real builtin plugin per the R294
 * toggle contract. Owns the "Show bookmarks" command (opens the left-sidebar
 * panel); disabling auto-disposes it and hides the panel tab + render. The
 * bookmarking ACTION commands (bookmark-file / bookmark-heading / etc.) stay in
 * App.tsx - they remain useful (data is stored) even when the panel is hidden.
 * The panel (BookmarksPanel) is hosted by the App shell and is the final
 * left-panel fallback.
 */
export const bookmarksPlugin: GeodePlugin = {
  id: "bookmarks",
  name: () => t("settings.corePlugin.bookmarks"),
  description: () => t("settings.corePlugin.bookmarksDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "bookmarks:show",
      name: () => t("cmd.showBookmarks"),
      callback: () => app.workspace.setLeftPanel("bookmarks"),
    });
  },
};
