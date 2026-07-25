import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Properties view - the right-sidebar panel listing all properties across the
 * vault (Obsidian's "Properties view" core plugin). R297: wired as a real
 * builtin plugin per the R294 toggle contract. Owns the "Show all properties"
 * command; disabling auto-disposes it and hides the panel tab + render. The
 * panel (AllPropertiesPanel) is hosted by the App shell.
 */
export const propertiesViewPlugin: GeodePlugin = {
  id: "properties-view",
  name: () => t("settings.corePlugin.propertiesView"),
  description: () => t("settings.corePlugin.propertiesViewDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:show-all-properties",
      name: () => t("cmd.showAllProperties"),
      callback: () => app.workspace.setRightPanel("allproperties"),
    });
  },
};
