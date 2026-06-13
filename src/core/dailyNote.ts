import moment from "moment/min/moment-with-locales";
import { Store } from "./store";
import { expandTemplate } from "./templates";
import type { Vault } from "./vault";
import type { Workspace } from "./workspace";

/* ============================ configurable settings (R48) ============================ */

const FOLDER_KEY = "geode.dailyNote.folder";
const FORMAT_KEY = "geode.dailyNote.format";
const TEMPLATE_KEY = "geode.dailyNote.template";
const DEFAULT_FOLDER = "Daily Notes";
const DEFAULT_FORMAT = "YYYY-MM-DD";

/** Back-compat default folder (was the only value pre-R48). */
export const DAILY_FOLDER = DEFAULT_FOLDER;

function readInitial(key: string, fallback: string): string {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — session-only */
  }
}

/** New-note folder (default "Daily Notes", persisted, stored RAW — trim at use). */
export const dailyNoteFolder = new Store<string>(readInitial(FOLDER_KEY, DEFAULT_FOLDER));
export function setDailyNoteFolder(v: string): void {
  dailyNoteFolder.set(v);
  persist(FOLDER_KEY, v);
}

/** moment date format for the filename (default "YYYY-MM-DD", persisted, RAW). */
export const dailyNoteFormat = new Store<string>(readInitial(FORMAT_KEY, DEFAULT_FORMAT));
export function setDailyNoteFormat(v: string): void {
  dailyNoteFormat.set(v);
  persist(FORMAT_KEY, v);
}

/** Optional template note path applied to a freshly-created daily note (default "" = none). */
export const dailyNoteTemplate = new Store<string>(readInitial(TEMPLATE_KEY, ""));
export function setDailyNoteTemplate(v: string): void {
  dailyNoteTemplate.set(v);
  persist(TEMPLATE_KEY, v);
}

/** Effective folder: trimmed + stripped of leading/trailing slashes (a trailing
 *  "/" would otherwise make a "folder//date.md" double-slash path — R17
 *  attachmentFolder precedent), and rejected back to DEFAULT if any segment is
 *  empty / "." / ".." / dot-prefixed (no traversal, no hidden folders — R48 review;
 *  mirrors templates.ts validateDir). A "/" in a configured FORMAT is still NOT
 *  supported (basename parser assumes a flat date filename — known deviation). */
function effFolder(): string {
  const raw = dailyNoteFolder.get().trim().replace(/^\/+|\/+$/g, "");
  if (raw === "") return DEFAULT_FOLDER;
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === "." || seg === ".." || seg.startsWith(".")) return DEFAULT_FOLDER;
  }
  return raw;
}
function effFormat(): string {
  return dailyNoteFormat.get().trim() || DEFAULT_FORMAT;
}

/* ============================ pure date helpers ============================ */

/** The configured date stamp for a date (default YYYY-MM-DD, local). */
export function dailyStamp(date: Date): string {
  return moment(date).format(effFormat());
}

export function dailyNotePath(date: Date): string {
  return `${effFolder()}/${dailyStamp(date)}.md`;
}

/** Parse the configured date stamp out of a path's BASENAME → local-midnight Date,
 *  or null. moment STRICT parse against the configured format keeps the R43
 *  over-match guards (embedded digits "12025-06-14.md", date-named PARENT folders
 *  "2020-01-01-backup/2026-06-14.md", impossible dates "2026-13-40") all → null. */
export function parseDailyStamp(path: string): Date | null {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const m = moment(base, effFormat(), true); // strict
  return m.isValid() ? m.toDate() : null;
}

/** True iff `path` is a daily note under the configured folder (gates relative nav
 *  so only a REAL daily note seeds the base date — R43 review fix). */
export function isDailyNotePath(path: string): boolean {
  return path.startsWith(effFolder() + "/") && parseDailyStamp(path) !== null;
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

/* ============================ create/open ============================ */

/** New note body: the configured template (expanded) if set + readable, else a
 *  "# stamp" heading. */
async function dailyNoteContent(vault: Vault, date: Date): Promise<string> {
  const tpl = dailyNoteTemplate.get().trim();
  if (tpl) {
    const tplPath = /\.md$/i.test(tpl) ? tpl : `${tpl}.md`;
    if (vault.fileExists(tplPath)) {
      try {
        const raw = await vault.read(tplPath);
        return expandTemplate(raw, { title: dailyStamp(date), now: date });
      } catch (err) {
        console.error("[daily-note] template read failed — falling back to heading", err);
      }
    }
  }
  return `# ${dailyStamp(date)}\n\n`;
}

/** Open (creating if needed) the daily note for `date`, honoring the configured
 *  folder/format/template. Decoupled (explicit vault+workspace) so both the plugin
 *  (AppHandle) and the calendar feature (GeodeApp) can call it. */
export async function openOrCreateDailyNote(vault: Vault, workspace: Workspace, date: Date): Promise<void> {
  const path = dailyNotePath(date);
  if (!vault.fileExists(path)) {
    try { await vault.createFolder(effFolder()); } catch { /* folder exists */ }
    try {
      await vault.create(path, await dailyNoteContent(vault, date));
    } catch (err) {
      // create can reject because the note appeared meanwhile (race / the file
      // already existed on disk): still open it. Only bail if it truly isn't there.
      if (!vault.fileExists(path)) { console.error("[daily-note] create failed", err); return; }
    }
  }
  workspace.openFile(path);
}
