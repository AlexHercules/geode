import moment from "moment/min/moment-with-locales";
import { Store } from "./store";
import { expandTemplate } from "./templates";
import type { Vault } from "./vault";
import type { Workspace } from "./workspace";

/* ============================ Unique note creator (R53) ============================
 * Obsidian's "Unique note creator" core plugin: one command creates a new note named
 * by a moment timestamp (Zettelkasten id) in a configured folder, optionally seeded
 * from a template, then opens it. Mirrors core/dailyNote.ts (R48 configurable daily
 * notes) — same Store/localStorage/effFolder/template-expand shape — minus the
 * date-parse / calendar / relative-nav (a unique note is never navigated back to by
 * its id, so no parseStamp/isUniquePath/monthGrid are needed). Zero new dependency. */

const FOLDER_KEY = "geode.uniqueNote.folder";
const FORMAT_KEY = "geode.uniqueNote.format";
const TEMPLATE_KEY = "geode.uniqueNote.template";
const DEFAULT_FOLDER = ""; // vault root (Obsidian default location for a unique note)
const DEFAULT_FORMAT = "YYYYMMDDHHmmss";

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

/** Folder for new unique notes (default "" = vault root, persisted, stored RAW). */
export const uniqueNoteFolder = new Store<string>(readInitial(FOLDER_KEY, DEFAULT_FOLDER));
export function setUniqueNoteFolder(v: string): void {
  uniqueNoteFolder.set(v);
  persist(FOLDER_KEY, v);
}

/** moment format for the filename / id (default "YYYYMMDDHHmmss", persisted, RAW). */
export const uniqueNoteFormat = new Store<string>(readInitial(FORMAT_KEY, DEFAULT_FORMAT));
export function setUniqueNoteFormat(v: string): void {
  uniqueNoteFormat.set(v);
  persist(FORMAT_KEY, v);
}

/** Optional template note path applied to a freshly-created unique note (default "" = none). */
export const uniqueNoteTemplate = new Store<string>(readInitial(TEMPLATE_KEY, ""));
export function setUniqueNoteTemplate(v: string): void {
  uniqueNoteTemplate.set(v);
  persist(TEMPLATE_KEY, v);
}

/** Effective folder: trimmed + stripped of leading/trailing slashes; "" (root) is a
 *  VALID value here (Obsidian default), and any traversal / hidden / empty segment
 *  falls back to root rather than a named folder (mirrors dailyNote.effFolder's
 *  validateDir, but root is the safe default instead of "Daily Notes"). A "/" in a
 *  configured FORMAT is still NOT supported (the filename is assumed flat). */
function effFolder(): string {
  const raw = uniqueNoteFolder.get().trim().replace(/^\/+|\/+$/g, "");
  if (raw === "") return "";
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === "." || seg === ".." || seg.startsWith(".")) return "";
  }
  return raw;
}
function effFormat(): string {
  return uniqueNoteFormat.get().trim() || DEFAULT_FORMAT;
}

/** The unique note's name (no extension) for a given instant — the configured
 *  moment timestamp (default YYYYMMDDHHmmss, local). Pure → probe-asserted. */
export function uniqueNoteName(date: Date): string {
  return moment(date).format(effFormat());
}

/** The would-be path (effective folder + name + ".md") for `date`, BEFORE collision
 *  suffixing (vault.uniquePath handles collisions at create time). Pure → probe/preview. */
export function uniqueNotePathPreview(date: Date): string {
  const folder = effFolder();
  const name = uniqueNoteName(date);
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}

/** New-note body: the configured template (expanded) if set + readable, else empty
 *  (Obsidian's unique note is blank by default). */
async function uniqueNoteContent(vault: Vault, date: Date): Promise<string> {
  const tpl = uniqueNoteTemplate.get().trim();
  if (tpl) {
    const tplPath = /\.md$/i.test(tpl) ? tpl : `${tpl}.md`;
    if (vault.fileExists(tplPath)) {
      try {
        const raw = await vault.read(tplPath);
        return expandTemplate(raw, { title: uniqueNoteName(date), now: date });
      } catch (err) {
        console.error("[unique-note] template read failed — falling back to blank", err);
      }
    }
  }
  return "";
}

/**
 * Create a new unique note for `date` (honoring the configured folder/format/template)
 * and open it. `vault.uniquePath` guarantees a collision-free path (two notes created
 * within the same second get a " N" suffix). Returns the created path, or null on
 * failure. Decoupled (explicit vault+workspace) so the plugin can call it.
 */
export async function createUniqueNote(vault: Vault, workspace: Workspace, date: Date): Promise<string | null> {
  const folder = effFolder();
  if (folder) {
    try { await vault.createFolder(folder); } catch { /* folder exists */ }
  }
  const body = await uniqueNoteContent(vault, date);
  const base = uniqueNoteName(date);
  // Always create a NEW note (unlike daily notes' idempotent open-or-create). uniquePath
  // reads the in-memory index, but two same-tick triggers can both resolve the same free
  // path before either create lands; vault.create then rejects the loser (create_new /
  // Memory files.has — never overwrites). Retry on that collision: recompute uniquePath so
  // the second trigger gets "X 1.md" instead of silently re-opening "X.md". Bail only on a
  // genuine failure (path stays missing), and cap attempts as a runaway backstop.
  for (let attempt = 0; attempt < 50; attempt++) {
    const path = vault.uniquePath(folder, base);
    try {
      await vault.create(path, body);
      workspace.openFile(path);
      return path;
    } catch (err) {
      if (!vault.fileExists(path)) { console.error("[unique-note] create failed", err); return null; }
      // path now exists (a concurrent create won it) — loop recomputes the next free suffix
    }
  }
  console.error("[unique-note] create gave up after repeated path collisions");
  return null;
}
