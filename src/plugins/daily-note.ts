import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

const FOLDER = "Daily Notes";

/** Today's real calendar date as YYYY-MM-DD (local time). */
function todayStamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function openToday(app: AppHandle): Promise<void> {
  const stamp = todayStamp();
  const path = `${FOLDER}/${stamp}.md`;
  if (!app.vault.fileExists(path)) {
    try {
      await app.vault.createFolder(FOLDER);
    } catch {
      // folder probably already exists — fine
    }
    try {
      await app.vault.create(path, `# ${stamp}\n\n`);
    } catch (err) {
      console.error("[daily-note] failed to create today's note", err);
      return;
    }
  }
  app.workspace.openFile(path);
}

/**
 * Daily notes — Ctrl+D opens (creating if needed) "Daily Notes/YYYY-MM-DD.md"
 * for today's date.
 */
export const dailyNotePlugin: GeodePlugin = {
  id: "daily-note",
  name: "Daily notes",
  description: "Open (or create) a note for today under \"Daily Notes/\" with Ctrl+D.",
  version: "1.0.0",

  onload(app: AppHandle) {
    // commands.register via the plugin handle auto-tracks the disposer
    app.commands.register({
      id: "daily-note:open-today",
      name: () => t("cmd.dailyNote"),
      hotkey: "Ctrl+D",
      callback: () => void openToday(app),
    });
  },
};
