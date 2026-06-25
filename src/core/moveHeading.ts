/**
 * R216 (G3 §12): the section range for "Move current heading to a new note" (Obsidian
 * note-composer:move-heading). PURE — given the doc text + a cursor offset, returns the
 * [from, to) span of the section the cursor is in (the heading line at/above the cursor,
 * through everything up to the next heading at the same-or-higher level). The impure move
 * (vault.create + source splice) reuses R44's extract path in noteComposerCommands.ts.
 *
 * Heading detection runs on maskCodeRegions(text) (same code/fence masking every Geode
 * scanner uses — resolveSubpath / unlinkedMentions / renameHeading) so a `## x` inside a
 * fence is never a heading; same-length blanking keeps offsets byte-aligned with the raw
 * text. ATX only (matches R204 rename-heading); setext is out of scope.
 */
import { maskCodeRegions, parseFrontmatter } from "./metadata";

// an ATX heading line: 1–6 leading '#', whitespace, then at least one non-space char.
const HEADING_RE = /^(#{1,6})\s+\S/;

/**
 * The section span containing `pos`, or null when `pos` is before the first heading
 * (no section to move). `to` is trimmed of trailing whitespace so the source keeps its
 * blank-line spacing before the next heading after the section is replaced by a link.
 */
export function headingSectionAt(text: string, pos: number): { from: number; to: number } | null {
  // Blank a leading YAML frontmatter block (offset-preserving: every non-newline char → space)
  // BEFORE masking code, so a column-0 `# comment` line inside frontmatter is never matched as a
  // heading. Every other Geode heading scanner (parseNote / resolveSubpath) excludes frontmatter;
  // missing it here would splice the link across the closing `---` and gut the note (底线①, R216
  // review). Same-length blanking keeps offsets byte-aligned with the raw `text` used for slicing.
  const fm = parseFrontmatter(text);
  const base = fm ? text.slice(0, fm.to).replace(/[^\n]/g, " ") + text.slice(fm.to) : text;
  const masked = maskCodeRegions(base);
  const heads: Array<{ start: number; level: number }> = [];
  let i = 0;
  while (i <= masked.length) {
    let end = masked.indexOf("\n", i);
    if (end === -1) end = masked.length;
    const m = HEADING_RE.exec(masked.slice(i, end));
    if (m) heads.push({ start: i, level: m[1].length });
    if (end === masked.length) break;
    i = end + 1;
  }
  // the section = the last heading whose line starts at or before the cursor
  let idx = -1;
  for (let k = 0; k < heads.length; k++) {
    if (heads[k].start <= pos) idx = k;
    else break;
  }
  if (idx === -1) return null;
  const from = heads[idx].start;
  const level = heads[idx].level;
  let rawTo = text.length;
  for (let k = idx + 1; k < heads.length; k++) {
    if (heads[k].level <= level) { rawTo = heads[k].start; break; }
  }
  const to = from + text.slice(from, rawTo).replace(/\s+$/, "").length;
  return { from, to };
}
