/**
 * R89 (㊽): "Default location for new notes" — Obsidian's Files & Links setting.
 * Governs where a brand-new note (no explicit folder context) is created:
 *   root    — vault root
 *   current — same folder as the active file
 *   folder  — the folder specified below (`newNoteFolder`)
 *
 * The right-click "New note here" / extract-to-note paths pass their own folder
 * and DON'T consult this setting (matches Obsidian). Default "root" = the prior
 * hard-coded `uniquePath("", …)` behaviour → zero regression.
 */
import { Store } from "./store";
import { parentPath, type Vault } from "./vault";

export type NewNoteLocation = "root" | "current" | "folder";

const LOCATION_KEY = "geode.newNoteLocation";
const FOLDER_KEY = "geode.newNoteFolder";

function readLocation(): NewNoteLocation {
  try {
    const v = localStorage.getItem(LOCATION_KEY);
    return v === "current" || v === "folder" ? v : "root";
  } catch {
    return "root";
  }
}
function readFolder(): string {
  try {
    return localStorage.getItem(FOLDER_KEY) ?? "";
  } catch {
    return "";
  }
}
function persist(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable — session-only */
  }
}

export const newNoteLocation = new Store<NewNoteLocation>(readLocation());
export const newNoteFolder = new Store<string>(readFolder());

export function setNewNoteLocation(loc: NewNoteLocation): void {
  newNoteLocation.set(loc);
  persist(LOCATION_KEY, loc === "root" ? "" : loc);
}
export function setNewNoteFolder(folder: string): void {
  newNoteFolder.set(folder);
  persist(FOLDER_KEY, folder.trim());
}

/** The folder a brand-new note should go in, per the setting. Pure (reads Stores
 *  + the passed active path); exported for the probe. */
export function resolveNewNoteFolder(activePath: string | null): string {
  switch (newNoteLocation.get()) {
    case "current":
      return activePath ? parentPath(activePath) : "";
    case "folder":
      // strip leading/trailing slashes — a leading "/" would fail assertSafeRelPath
      return newNoteFolder.get().trim().replace(/^\/+|\/+$/g, "");
    default:
      return "";
  }
}

/**
 * Create a new note honouring the default-location setting, then return its path.
 * A `name` that carries its own folder ("sub/Note") is treated as vault-relative
 * and is NOT nested under the configured folder. Ensures the target folder exists
 * (mirrors uniqueNote) before the collision-safe create.
 */
export async function createNewNote(
  vault: Vault,
  name: string,
  activePath: string | null,
  content = "",
): Promise<string> {
  const folder = name.includes("/") ? "" : resolveNewNoteFolder(activePath);
  if (folder) {
    try {
      await vault.createFolder(folder);
    } catch {
      /* folder already exists — fine */
    }
  }
  const path = vault.uniquePath(folder, name);
  await vault.create(path, content);
  return path;
}
