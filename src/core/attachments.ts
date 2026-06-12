/**
 * Attachment ingestion engine (R17) — resolve where pasted/dropped binaries
 * land (Obsidian attachmentFolderPath semantics) and import them into the
 * vault. See ARCHITECTURE.md "Round 17 additions" for the frozen contract.
 */
import type { MetadataIndex } from "./metadata";
import { Store } from "./store";
import type { Vault } from "./vault";

const STORAGE_KEY = "geode.attachmentFolder";
const DEFAULT_FOLDER = "assets";

function readInitial(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? DEFAULT_FOLDER : stored;
  } catch {
    return DEFAULT_FOLDER;
  }
}

/** Attachment folder setting (default "assets", persisted). Stored RAW —
 *  trimming happens at consumption (resolveAttachmentDir); trimming here would
 *  fight the controlled settings input on every keystroke (review fix). */
export const attachmentFolder = new Store<string>(readInitial());

export function setAttachmentFolder(value: string): void {
  attachmentFolder.set(value);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable — session-only */
  }
}

/** Strip leading/trailing forward slashes (paths are forward-slash only). */
function stripSlashes(p: string): string {
  return p.replace(/^\/+|\/+$/g, "");
}

/** Parent directory of a vault-relative file path ("" for the root). */
function parentDir(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/**
 * Obsidian attachmentFolderPath semantics (frozen):
 *   ""/"/"        -> vault root (returns "")
 *   "./"          -> same folder as the note
 *   "./sub/x"     -> subpath under the note's folder
 *   "folder/sub"  -> fixed vault-level folder
 * Returns a vault-relative directory (no trailing "/", root = "").
 * notePath contributes its parent directory.
 */
export function resolveAttachmentDir(notePath: string, setting: string): string {
  const s = setting.trim();
  if (stripSlashes(s) === "") return ""; // "" or "/" -> vault root
  const noteDir = parentDir(notePath);
  if (s === "." || s === "./") return noteDir;
  if (s.startsWith("./")) {
    const sub = stripSlashes(s.slice(2));
    if (!sub) return noteDir;
    return noteDir ? `${noteDir}/${sub}` : sub;
  }
  return stripSlashes(s);
}

// Path separators, Windows-illegal punctuation and control characters.
// eslint-disable-next-line no-control-regex
const ILLEGAL_NAME_CHARS = new RegExp('[\\\\/:*?"<>|\\u0000-\\u001f\\u007f]', "g");

/** Replace path separators, \/:*?"<>| and control characters with "-", and
 *  strip leading dots — a dot-prefixed attachment would be written but stay
 *  invisible to the tree/watcher/index forever (dotfile noise filter), a UI
 *  black hole (review fix). An empty result falls back to "attachment". */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(ILLEGAL_NAME_CHARS, "-").replace(/^\.+/, "");
  return cleaned === "" ? "attachment" : cleaned;
}

/** A usable attachment dir: no ""/"."/".." segments (".." would be rejected by
 *  safe_join on desktop but silently honoured by the Memory adapter) and no
 *  dot-prefixed segments (invisible to the tree — see sanitizeFileName). */
function validateDir(dir: string, setting: string): void {
  if (dir === "") return;
  for (const seg of dir.split("/")) {
    if (seg === "" || seg === "." || seg === ".." || seg.startsWith(".")) {
      throw new Error(`invalid attachment folder setting: "${setting}"`);
    }
  }
}

export interface ImportAttachmentDeps {
  vault: Vault;
  metadata: MetadataIndex;
}

/**
 * Import raw bytes into the attachment directory:
 * sanitize baseName -> resolveAttachmentDir(notePath, attachmentFolder.get())
 * -> create the directory if missing (createFolder = create_dir_all on both
 * adapters) -> vault.uniquePath collision avoidance -> vault.createBinary.
 * linktext: after createBinary, when resolveAttachment(fileName, notePath)
 * === path the bare file name (basename incl. extension) suffices; otherwise
 * the full path disambiguates (fileToLinktext spirit, R16 lineage).
 * Errors propagate to the caller (which owns UI feedback).
 */
export async function importAttachment(
  deps: ImportAttachmentDeps,
  notePath: string,
  baseName: string,
  data: Uint8Array,
): Promise<{ path: string; linktext: string }> {
  // Serialize imports (R16 engine precedent): uniquePath reads the filePaths
  // index, which only learns about a new file AFTER its createBinary finished
  // — two overlapping imports of the same name (same-second pastes) would
  // both get the same path. A failed import must not poison the queue.
  const next = chain.then(() => doImport(deps, notePath, baseName, data));
  chain = next.catch(() => undefined);
  return next;
}

let chain: Promise<unknown> = Promise.resolve();

async function doImport(
  deps: ImportAttachmentDeps,
  notePath: string,
  baseName: string,
  data: Uint8Array,
): Promise<{ path: string; linktext: string }> {
  const sanitized = sanitizeFileName(baseName);
  const dot = sanitized.lastIndexOf(".");
  let stem: string;
  let ext: string;
  if (dot > 0 && dot < sanitized.length - 1) {
    stem = sanitized.slice(0, dot);
    ext = sanitized.slice(dot + 1);
  } else {
    // Callers must supply an extension (paste names are generated with one,
    // drop keeps the original file name). Degrade defensively.
    console.warn(`[attachments] baseName without extension: "${baseName}" — defaulting to .png`);
    stem = sanitized;
    ext = "png";
  }

  const setting = attachmentFolder.get();
  const dir = resolveAttachmentDir(notePath, setting);
  validateDir(dir, setting);
  if (dir && !deps.vault.folderExists(dir)) {
    await deps.vault.createFolder(dir);
  }

  // uniquePath is the contract mechanism; layer a case-insensitive check on
  // top — Windows filesystems are case-insensitive, so "img.png" colliding
  // with an existing "Img.png" would pass uniquePath but fail on disk
  // (vault_write_binary's create_new rejects it — review fix).
  let path = deps.vault.uniquePath(dir, stem, ext);
  const lower = new Set(deps.vault.getFiles().map((f) => f.path.toLowerCase()));
  if (lower.has(path.toLowerCase())) {
    const prefix = dir ? `${dir}/` : "";
    let n = 1;
    while (lower.has(`${prefix}${stem} ${n}.${ext}`.toLowerCase())) n++;
    path = `${prefix}${stem} ${n}.${ext}`;
  }
  await deps.vault.createBinary(path, data);

  const fileName = path.split("/").pop()!;
  const linktext = deps.metadata.resolveAttachment(fileName, notePath) === path ? fileName : path;
  return { path, linktext };
}
