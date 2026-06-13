import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";
import { addDays, isDailyNotePath, openOrCreateDailyNote, parseDailyStamp } from "@core/dailyNote";

/** Base date for relative nav: the active file's date IFF it's a real daily note
 *  (under Daily Notes/), else today — so a stray date-named file elsewhere can't
 *  hijack the base or silently navigate out of its folder (R43 review fix). */
function baseDate(app: AppHandle): Date {
  const active = app.workspace.getActiveFile();
  const fromActive = active && isDailyNotePath(active) ? parseDailyStamp(active) : null;
  return fromActive || new Date();
}

/**
 * Daily notes — Mod+D opens (creating if needed) today's note; next/prev-day
 * (no default key) step from the active daily note (or today) by ±1 day.
 */
export const dailyNotePlugin: GeodePlugin = {
  id: "daily-note",
  name: () => t("plugin.dailyNote.name"),
  description: () => t("plugin.dailyNote.desc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "daily-note:open-today",
      name: () => t("cmd.dailyNote"),
      hotkey: "Mod+D",
      callback: () => void openOrCreateDailyNote(app.vault, app.workspace, new Date()),
    });
    app.commands.register({
      id: "daily-note:next-day",
      name: () => t("cmd.dailyNoteNext"),
      callback: () => void openOrCreateDailyNote(app.vault, app.workspace, addDays(baseDate(app), 1)),
    });
    app.commands.register({
      id: "daily-note:prev-day",
      name: () => t("cmd.dailyNotePrev"),
      callback: () => void openOrCreateDailyNote(app.vault, app.workspace, addDays(baseDate(app), -1)),
    });
  },
};
