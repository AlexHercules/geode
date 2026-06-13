/**
 * R44 Note composer (extract slice) — PURE helpers for "extract current
 * selection → new note". The impure orchestration (vault.create + editor
 * dispatch) lives in features/editor/noteComposerCommands.ts; keeping these
 * pure lets browser + desktop probes assert name/content/link deterministically.
 */

export type ExtractMode = "link" | "embed";

// strip the chars that break a filename (/ \ : * ? " < >) OR a wikilink
// ([ ] # ^ |) — one class guards both.
const ILLEGAL_RE = /[[\]#^|/\\:*?"<>]/g;
// C0/C1 control chars (NUL, BEL, …) — \s does NOT cover the non-whitespace
// controls, so they would otherwise leak into the basename + wikilink (review fix).
const CONTROL_RE = /\p{Cc}/gu;
// keep basenames well under the 255-BYTE single-component limit (APFS/ext4),
// leaving room for uniquePath's " N.md" suffix; cut on a code-point boundary.
const MAX_NAME_BYTES = 200;

function truncateBytes(s: string, maxBytes: number): string {
  if (new TextEncoder().encode(s).length <= maxBytes) return s;
  let out = "";
  let bytes = 0;
  for (const ch of s) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > maxBytes) break;
    out += ch;
    bytes += b;
  }
  return out;
}

/** Sanitize a raw string into a basename safe for BOTH the filesystem AND a
 *  wikilink: strips control chars + illegal/metachars, collapses internal
 *  whitespace, trims, drops leading AND trailing dots (no hidden/".."-style or
 *  trailing-dot names), byte-truncates to a safe length. A name that reduces to
 *  empty or all-dots → "Untitled". */
export function sanitizeNoteName(raw: string): string {
  const cleaned = raw
    .replace(CONTROL_RE, " ")
    .replace(ILLEGAL_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "") // leading & trailing dots → ".", ".." etc. collapse to ""
    .trim();
  if (cleaned.length === 0) return "Untitled";
  return truncateBytes(cleaned, MAX_NAME_BYTES).trim() || "Untitled";
}

/** Derive a default note name from the extracted text: the first non-empty
 *  line, with a leading ATX heading marker stripped ("## Title" → "Title"),
 *  sanitized. */
export function deriveNoteName(selectedText: string): string {
  let firstLine = "";
  for (const line of selectedText.split("\n")) {
    if (line.trim().length > 0) { firstLine = line; break; }
  }
  const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(firstLine);
  return sanitizeNoteName(heading ? heading[1] : firstLine);
}

/** The new note's content from the selection: verbatim, trailing whitespace/
 *  newlines normalized to a single trailing newline. */
export function extractedContent(selectedText: string): string {
  return selectedText.replace(/\s+$/, "") + "\n";
}

/** Text spliced in place of the selection in the SOURCE note. */
export function extractReplacement(noteName: string, mode: ExtractMode): string {
  return mode === "embed" ? `![[${noteName}]]` : `[[${noteName}]]`;
}
