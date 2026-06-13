import type { Vault } from "./vault";
import type { Workspace } from "./workspace";

/** R43: daily-note conventions (folder + YYYY-MM-DD, matching the daily-note plugin). */
export const DAILY_FOLDER = "Daily Notes";

/** Local YYYY-MM-DD for a date. */
export function dailyStamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dailyNotePath(date: Date): string {
  return `${DAILY_FOLDER}/${dailyStamp(date)}.md`;
}

/** Parse a YYYY-MM-DD stamp out of a path's BASENAME → local-midnight Date, or
 *  null. Anchored to the basename (optionally + ".md") so embedded digits
 *  ("12025-06-14.md", "meeting-2026-06-14.md") and date-named PARENT folders
 *  ("2020-01-01-backup/2026-06-14.md") never over-match the real file name
 *  (R43 review fix); rejects impossible dates (2026-13-40) via a round-trip check. */
export function parseDailyStamp(path: string): Date | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\.md)?$/.exec(base);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** True iff `path` is a daily note under DAILY_FOLDER (e.g. "Daily Notes/2026-06-14.md").
 *  Gates relative nav (next/prev-day) so only a REAL daily note seeds the base date —
 *  a stray date-named file elsewhere ("Archive/2026-06-14.md") falls back to today
 *  instead of silently navigating out of its folder (R43 review fix). */
export function isDailyNotePath(path: string): boolean {
  return path.startsWith(DAILY_FOLDER + "/") && parseDailyStamp(path) !== null;
}

export function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 6 weeks x 7 days, Sunday-start, including adjacent-month fill; each cell local midnight. */
export function monthGrid(year: number, month0: number): Date[][] {
  const first = new Date(year, month0, 1);
  const startDay = first.getDate() - first.getDay(); // back to the Sunday on/before the 1st
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) row.push(new Date(year, month0, startDay + w * 7 + d));
    weeks.push(row);
  }
  return weeks;
}

/** Open (creating if needed) the daily note for `date`. Decoupled (explicit
 *  vault+workspace) so both the plugin (AppHandle) and the calendar feature
 *  (GeodeApp) can call it. */
export async function openOrCreateDailyNote(vault: Vault, workspace: Workspace, date: Date): Promise<void> {
  const path = dailyNotePath(date);
  if (!vault.fileExists(path)) {
    try { await vault.createFolder(DAILY_FOLDER); } catch { /* folder exists */ }
    try {
      await vault.create(path, `# ${dailyStamp(date)}\n\n`);
    } catch (err) {
      // create can reject because the note appeared meanwhile (race / the file
      // already existed on disk): still open it. Only bail if it truly isn't there.
      if (!vault.fileExists(path)) { console.error("[daily-note] create failed", err); return; }
    }
  }
  workspace.openFile(path);
}
