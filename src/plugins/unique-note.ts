import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";
import { createUniqueNote } from "@core/uniqueNote";

/**
 * Unique note creator — one command creates a new note named by a moment timestamp
 * (Zettelkasten id) in the configured folder, optionally from a template, and opens
 * it (Obsidian's "Unique note creator" core plugin). No default hotkey (Obsidian
 * leaves it unbound). Folder / format / template are configurable in Settings.
 */
export const uniqueNotePlugin: GeodePlugin = {
  id: "unique-note",
  name: () => t("plugin.uniqueNote.name"),
  description: () => t("plugin.uniqueNote.desc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "unique-note:create",
      name: () => t("cmd.uniqueNote"),
      callback: () => void createUniqueNote(app.vault, app.workspace, new Date()),
    });
  },
};
