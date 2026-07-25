import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";
import { templatePickerMode } from "@core/templates";

/**
 * Templates - insert reusable template files into notes / create notes from
 * templates (Obsidian's "Templates" core plugin). R297: wired as a real builtin
 * plugin per the R294 toggle contract. Owns the "Insert template" /
 * "Create new note from template" commands (openModal("templates")); disabling
 * auto-disposes them so the templates modal can't open. The modal + its
 * one-shot `templatePickerMode` are hosted by the App shell.
 */
export const templatesPlugin: GeodePlugin = {
  id: "templates",
  name: () => t("settings.templates"),
  description: () => t("settings.corePlugin.templatesDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "editor:insert-template",
      name: () => t("cmd.insertTemplate"),
      available: () => app.workspace.getActiveTab()?.filePath != null,
      callback: () => {
        const tab = app.workspace.getActiveTab();
        if (!tab || !tab.filePath) return;
        // reading view has no cursor - flip to an editable mode first
        if (tab.mode === "preview") app.workspace.setTabMode(tab.id, "live");
        // one-shot mode handoff: set BEFORE opening, the modal reads on mount
        templatePickerMode.set("insert");
        app.workspace.openModal("templates");
      },
    });
    app.commands.register({
      id: "app:new-note-from-template",
      name: () => t("cmd.newNoteFromTemplate"),
      callback: () => {
        templatePickerMode.set("create");
        app.workspace.openModal("templates");
      },
    });
  },
};
