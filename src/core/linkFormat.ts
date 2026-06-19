/**
 * R72 (㉞-c) New-link format settings — control how NEW links are created:
 *   • link type:  wikilink `[[..]]`  vs  markdown `[..](..)`
 *   • path format: shortest (basename if it resolves back, else vault-root path) /
 *     relative (`../` — markdown only) / absolute (vault-root path)
 * Mirrors the localStorage Store + setter pattern (autoUpdateLinks / appearance).
 * Defaults preserve prior behavior: wikilink + shortest.
 *
 * `formatLink()` is the single source every "file → link" construction point
 * consults (attachments drop/paste, note-composer; the `[[` completion uses only
 * the path-format since the user already chose wikilink by typing `[[`). It
 * mirrors the fileToLinktext rule (resolve-back verified, R67/R70) and enforces
 * two HARD degradation guards imposed by Geode's resolvers:
 *   (a) wikilink + relative → shortest  — resolveLink cannot resolve `../`
 *   (b) embed → always wikilink `![[..]]` — markdown `![](path)` image/note
 *       embeds do not render (R71); a markdown embed would silently not display.
 * Returns null when no safe, resolve-back-verified form exists (caller skips,
 * mirroring internalDropSnippet's "don't insert a broken link" contract).
 */
import type { MetadataIndex } from "./metadata";
import { Store } from "./store";

export type LinkPathFormat = "shortest" | "relative" | "absolute";

const USE_MD_KEY = "geode.linkUseMarkdown";
const PATH_FMT_KEY = "geode.linkPathFormat";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch {
    return fallback;
  }
}

function readPathFormat(): LinkPathFormat {
  try {
    const v = localStorage.getItem(PATH_FMT_KEY);
    return v === "relative" || v === "absolute" ? v : "shortest";
  } catch {
    return "shortest";
  }
}

/** Create markdown links `[..](..)` instead of wikilinks `[[..]]` (default OFF). */
export const linkUseMarkdown = new Store<boolean>(readBool(USE_MD_KEY, false));
/** Path form for new links (default "shortest"). */
export const linkPathFormat = new Store<LinkPathFormat>(readPathFormat());

export function setLinkUseMarkdown(on: boolean): void {
  linkUseMarkdown.set(on);
  try {
    localStorage.setItem(USE_MD_KEY, String(on));
  } catch {
    /* storage unavailable — session-only */
  }
}

export function setLinkPathFormat(fmt: LinkPathFormat): void {
  linkPathFormat.set(fmt);
  try {
    localStorage.setItem(PATH_FMT_KEY, fmt);
  } catch {
    /* storage unavailable — session-only */
  }
}

/** Characters that cannot be expressed cleanly inside `[[..]]` (R67). */
const WIKILINK_UNSAFE = /[[\]#|^]/;

/** Percent-encode the chars that would break `[..](href)` on re-parse (R70):
 *  `%` first so the encodings introduced below are not double-encoded. */
export function encodeMdHref(path: string): string {
  return path
    .replace(/%/g, "%25")
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
}

/** Posix path from fromPath's folder to targetPath, always `./`- or `../`-prefixed
 *  so resolveMarkdownLink resolves it file-relative (a bare `note.md` would be read
 *  as a vault-root/basename target, not same-folder). */
function relativePath(fromPath: string, targetPath: string): string {
  const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")).split("/") : [];
  const to = targetPath.split("/");
  const file = to.pop() ?? targetPath;
  let i = 0;
  while (i < fromDir.length && i < to.length && fromDir[i] === to[i]) i++;
  const segs = [...Array(fromDir.length - i).fill(".."), ...to.slice(i), file];
  const rel = segs.join("/");
  return segs[0] === ".." ? rel : "./" + rel;
}

/** Inner WIKILINK path text (no `.md` for notes, no wrapping), path-format applied
 *  (relative degrades to shortest — guard a), resolve-back verified. null = no
 *  safe form (unresolvable or contains a wikilink-unsafe char). */
export function wikilinkPath(metadata: MetadataIndex, targetPath: string, fromPath: string): string | null {
  const base = targetPath.slice(targetPath.lastIndexOf("/") + 1);
  const isMd = /\.md$/i.test(base);
  const resolve = (t: string): string | null =>
    isMd ? metadata.resolveLink(t, fromPath) : metadata.resolveAttachment(t, fromPath);
  const baseForm = isMd ? base.replace(/\.md$/i, "") : base;
  const fullForm = isMd ? targetPath.replace(/\.md$/i, "") : targetPath;
  let form: string | null;
  if (linkPathFormat.get() === "absolute") {
    form = resolve(fullForm) === targetPath ? fullForm : null;
  } else {
    form = resolve(baseForm) === targetPath ? baseForm : resolve(fullForm) === targetPath ? fullForm : null;
  }
  return form !== null && !WIKILINK_UNSAFE.test(form) ? form : null;
}

/** href for a MARKDOWN link (extension kept, percent-encoded), path-format applied,
 *  resolve-back verified (falls back to the vault-root path, else null). */
function markdownHref(metadata: MetadataIndex, targetPath: string, fromPath: string): string | null {
  const fmt = linkPathFormat.get();
  let path: string;
  if (fmt === "relative") {
    path = relativePath(fromPath, targetPath);
  } else if (fmt === "absolute") {
    path = targetPath;
  } else {
    const base = targetPath.slice(targetPath.lastIndexOf("/") + 1);
    path = metadata.resolveMarkdownLink(base, fromPath) === targetPath ? base : targetPath;
  }
  if (metadata.resolveMarkdownLink(path, fromPath) !== targetPath) {
    if (metadata.resolveMarkdownLink(targetPath, fromPath) !== targetPath) return null;
    path = targetPath;
  }
  return encodeMdHref(path);
}

/**
 * Build the link/embed text for `targetPath` referenced from `fromPath`, per the
 * current link-format settings. Returns null when no safe resolve-back-verified
 * form exists (caller must skip, never insert a broken link).
 */
export function formatLink(
  metadata: MetadataIndex,
  targetPath: string,
  fromPath: string,
  opts?: { embed?: boolean; alias?: string; subpath?: string },
): string | null {
  const embed = opts?.embed ?? false;
  // R77: optional subpath (e.g. a block id `^id` or heading) appended after the
  // resolved path with `#`. The path text is still resolve-back-verified +
  // unsafe-char-guarded; the subpath rides after the `#` separator.
  const sub = opts?.subpath ? `#${opts.subpath}` : "";
  // guard (b): embeds are always wikilink `![[..]]`
  const useMarkdown = !embed && linkUseMarkdown.get();
  if (!useMarkdown) {
    const inner = wikilinkPath(metadata, targetPath, fromPath);
    if (inner === null) return null;
    const alias = opts?.alias;
    const path = inner + sub;
    const body = alias !== undefined && alias !== inner ? `${path}|${alias}` : path;
    return embed ? `![[${body}]]` : `[[${body}]]`;
  }
  const href = markdownHref(metadata, targetPath, fromPath);
  if (href === null) return null;
  const base = targetPath.slice(targetPath.lastIndexOf("/") + 1);
  const display = opts?.alias ?? (/\.md$/i.test(base) ? base.replace(/\.md$/i, "") : base);
  // A `]` in the display text terminates MARKDOWN_LINK_RE's `[^\]]*` display
  // group early → `[a]b](href)` does not re-parse. Mirror the wikilink branch's
  // WIKILINK_UNSAFE guard: no safe form → null → caller skips (never write a
  // silently-broken link). The href tolerates `]` (its group is `[^\s)]+`).
  if (display.includes("]")) return null;
  // The subpath (heading/block fragment) must be percent-encoded for a MARKDOWN
  // link — its href group is `[^\s)]+`, so a raw `#Heading With Spaces` truncates
  // at the first space on re-parse (R112: generateMarkdownLink is the first caller
  // to combine markdown mode + an arbitrary heading subpath). The wikilink branch
  // above keeps `sub` raw — `[[Note#Heading With Spaces]]` is valid. `^` (block) is
  // not encoded by encodeMdHref, so `#^id` stays intact.
  const subMd = opts?.subpath ? `#${encodeMdHref(opts.subpath)}` : "";
  return `[${display}](${href}${subMd})`;
}
