import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Tags view - the right-sidebar panel listing every tag in the vault with its
 * count (Obsidian's "Tags view" core plugin). R294: the first always-on feature
 * wired as a real builtin plugin so the core-plugins toggle genuinely controls
 * it. The panel component itself (TagsPanel) is hosted by the App shell; this
 * plugin owns the "Show tags" command and the enable/disable lifecycle that
 * gates the panel tab + render (see ARCHITECTURE.md "Round 294 additions").
 */
export const tagsPlugin: GeodePlugin = {
  id: "tags",
  name: () => t("settings.corePlugin.tags"),
  description: () => t("settings.corePlugin.tagsDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    // commands.register via the plugin handle auto-tracks the disposer, so a
    // disable() removes the command from the palette + hotkey lookup.
    app.commands.register({
      id: "app:show-tags",
      name: () => t("cmd.showTags"),
      callback: () => app.workspace.setRightPanel("tags"),
    });
  },
};
