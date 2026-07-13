import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Command palette - the modal for running commands by name (Obsidian's "Command
 * palette" core plugin). R296: wired as a real builtin plugin per the R294
 * toggle contract. This plugin owns the "Open command palette" command (Mod+P);
 * disabling auto-disposes it (Mod+P becomes a no-op) and hides the ribbon
 * palette button. Lock-out safe: `app:open-settings` (Mod+,) is registered
 * independently in App.tsx (NOT here) and the ribbon settings gear is always
 * visible, so the user can always reach Settings to re-enable this plugin.
 */
export const commandPalettePlugin: GeodePlugin = {
  id: "command-palette",
  name: () => t("settings.section.commandPalette"),
  description: () => t("settings.corePlugin.commandPaletteDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:command-palette",
      name: () => t("cmd.commandPalette"),
      hotkey: "Mod+P",
      callback: () => app.workspace.openModal("palette"),
    });
  },
};
