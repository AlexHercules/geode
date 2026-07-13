import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Quick switcher - the modal for quickly opening/creating notes by name
 * (Obsidian's "Quick switcher" core plugin). R296: wired as a real builtin
 * plugin per the R294 toggle contract. This plugin owns the "Quick switcher:
 * open note" command (Mod+O); disabling auto-disposes it (Mod+O becomes a
 * no-op) and hides the empty-state switcher button. The modal itself is hosted
 * by the App shell. Lock-out safe: settings stays reachable via Mod+, / the
 * ribbon gear (neither is gated by this plugin).
 */
export const quickSwitcherPlugin: GeodePlugin = {
  id: "quick-switcher",
  name: () => t("settings.section.quickSwitcher"),
  description: () => t("settings.corePlugin.quickSwitcherDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:quick-switcher",
      name: () => t("cmd.quickSwitcher"),
      hotkey: "Mod+O",
      callback: () => app.workspace.openModal("switcher"),
    });
  },
};
