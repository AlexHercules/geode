import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * File recovery - browse and restore snapshots of edited files (Obsidian's
 * "File recovery" core plugin). R297: wired as a real builtin plugin per the
 * R294 toggle contract. Owns the "File recovery" command (openModal("recovery"));
 * disabling auto-disposes it so the recovery modal can't open. The modal is
 * hosted by the App shell.
 */
export const fileRecoveryPlugin: GeodePlugin = {
  id: "file-recovery",
  name: () => t("settings.corePlugin.fileRecovery"),
  description: () => t("settings.corePlugin.fileRecoveryDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "editor:file-recovery",
      name: () => t("cmd.fileRecovery"),
      available: () => app.workspace.getActiveFile() !== null,
      callback: () => app.workspace.openModal("recovery"),
    });
  },
};
