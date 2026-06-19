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

/* ---------- R102 (㊽ 续续续续续): attachment viewer routing ---------- */
//
// Which non-md files open in the read-only attachment viewer (`viewType:
// "attachment"`) instead of the markdown editor — the data-safety boundary that keeps
// binaries out of the editable/autosave path. Allowlist, not denylist: only known
// image/binary extensions route to the viewer, so unknown / text-ish files (.txt,
// .json, .csv, extensionless) stay editable markdown exactly as before (zero regression).

// Each previewable media family maps its extensions → MIME type (R104: audio/video/pdf
// joined images). The MIME is the blob `type` so <img>/<audio>/<video>/<embed> can decode.
// svg needs image/svg+xml; matching Obsidian's native audio/video format lists.
const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
};
const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav",
  ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", aiff: "audio/aiff", "3gp": "audio/3gpp",
};
const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  webm: "video/webm", ogv: "video/ogg", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", flv: "video/x-flv",
};
const IMAGE_EXTS = new Set(Object.keys(IMAGE_MIME));
/** other clearly-binary files — shown as a read-only placeholder (no inline preview). Kept
 *  broad on purpose: every binary kept off this list falls back to the editable markdown
 *  editor, where a UTF-8 round-trip + autosave would corrupt it (review fix — close the
 *  high-frequency holes). A future slice may flip to a denylist (only known text editable).
 *  Non-previewable images (heic/tiff/psd) live here too — attachment, but no <img>. */
const OTHER_BINARY_EXTS = new Set([
  // documents (pdf is previewable → handled separately below)
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "epub",
  // non-previewable images
  "heic", "heif", "tiff", "tif", "psd", "ai", "raw",
  // archives
  "zip", "7z", "rar", "tar", "gz", "bz2", "xz", "tgz",
  // executables / libraries / disk / data / fonts
  "exe", "dll", "so", "dylib", "bin", "wasm", "app", "deb", "rpm", "msi", "dmg", "iso",
  "db", "sqlite", "sqlite3", "ttf", "otf", "woff", "woff2",
]);

/** lowercased extension after the final dot of the basename, or "" if none. */
export function fileExtension(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** R104: which inline preview the attachment view renders — image (<img>), audio
 *  (<audio>), video (<video>), pdf (<embed>), or "other" (read-only placeholder). */
export type MediaKind = "image" | "audio" | "video" | "pdf" | "other";
export function mediaKind(path: string): MediaKind {
  // Object.hasOwn (NOT `in` / bracket truthiness): a file named e.g. "x.toString" must not
  // match an inherited Object.prototype key and be misclassified as a media type (review fix).
  const ext = fileExtension(path);
  if (Object.hasOwn(IMAGE_MIME, ext)) return "image";
  if (Object.hasOwn(AUDIO_MIME, ext)) return "audio";
  if (Object.hasOwn(VIDEO_MIME, ext)) return "video";
  if (ext === "pdf") return "pdf";
  return "other";
}

/** MIME type for the blob `type` of a previewable media path (octet-stream fallback). */
export function mediaMime(path: string): string {
  const ext = fileExtension(path);
  if (Object.hasOwn(IMAGE_MIME, ext)) return IMAGE_MIME[ext];
  if (Object.hasOwn(AUDIO_MIME, ext)) return AUDIO_MIME[ext];
  if (Object.hasOwn(VIDEO_MIME, ext)) return VIDEO_MIME[ext];
  return ext === "pdf" ? "application/pdf" : "application/octet-stream";
}

/** a previewable image (drives <img> vs placeholder; kept for the routing probe). */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(fileExtension(path));
}

/** true ⟺ this path opens in the read-only attachment viewer (image/audio/video/pdf or
 *  other binary). Same total set as R102 — audio/video/pdf just moved into preview kinds. */
export function isAttachmentPath(path: string): boolean {
  return mediaKind(path) !== "other" || OTHER_BINARY_EXTS.has(fileExtension(path));
}
