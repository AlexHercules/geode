/**
 * R204 (G3 §2): rename the heading under the cursor (Obsidian "Rename this heading…"). Pure string
 * ops, zero CM/React deps — testable via the `__geodeRenameHeading` probe; the editor command wraps
 * this in window.prompt + a single CM dispatch.
 *
 * Obsidian's core rename-heading renames only the heading text and does NOT update any `[[#…]]`
 * references (the dev has stated this won't be implemented — they silently break). Geode adds a
 * local enhancement: same-file self-anchor wikilinks following the rename. Cross-file `[[File#…]]`
 * rewrite is deferred (片 B) — like Obsidian's core, it is not updated here.
 *
 * Heading detection and the self-anchor scan run on `maskCodeRegions(text)` (the same code/fence
 * masking every other Geode scanner uses — resolveSubpath / unlinkedMentions / parseNote) so a
 * `## x` line inside a fence is not a heading and a `[[#x]]` literal inside code is never rewritten;
 * offsets stay byte-aligned (same-length blanking), so changes apply to the raw text.
 */
import { stripHeadingText, maskCodeRegions } from "./metadata";

const HEADING_LINE_RE = /^(#{1,6})\s+(.+)$/;
// self-anchor wikilink: (!?)[[#subpath(|alias)?]]. The subpath class excludes [ ] | # (nested refs);
// block refs `[[#^id]]` still match here but are skipped by the `^` guard below.
const SELF_ANCHOR_RE = /(!?)\[\[#([^[\]|#]+?)(\|[^[\]]*)?\]\]/g;
// new heading text that would break a `[[#…]]` link if written into a self-anchor subpath
const LINK_UNSAFE_RE = /[|[\]#]/;

export interface HeadingChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Locate the heading line containing `pos`: its text span [textFrom, textTo) + trimmed RAW text.
 * Detection uses `masked` (code-fence / inline-code blanked) so a `## x` INSIDE a fence is not a
 * heading; the span and oldText come from the raw `text`.
 */
function headingLineAt(text: string, masked: string, pos: number): { textFrom: number; textTo: number; oldText: string } | null {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  let lineEnd = text.indexOf("\n", pos);
  if (lineEnd === -1) lineEnd = text.length;
  if (!HEADING_LINE_RE.test(masked.slice(lineStart, lineEnd))) return null; // fenced `## x` → blanked → not a heading
  const m = HEADING_LINE_RE.exec(text.slice(lineStart, lineEnd));
  if (!m) return null;
  // m[2] (the `.+` text) runs to line end; textFrom skips the marker + its trailing whitespace
  return { textFrom: lineStart + (m[0].length - m[2].length), textTo: lineEnd, oldText: m[2].trim() };
}

/** The current heading's text at `pos` (the rename prompt's default), or null if not on a heading. */
export function currentHeadingText(text: string, pos: number): string | null {
  return headingLineAt(text, maskCodeRegions(text), pos)?.oldText ?? null;
}

/**
 * Rename the heading at `pos` to `newText`, plus update same-file self-anchor wikilinks
 * `[[#OldH]]` / `![[#OldH]]` / `[[#OldH|alias]]` whose stripped subpath matches the old heading
 * (mirrors resolveSubpath's case/markdown-insensitive match). Returns the sorted, non-overlapping
 * changes, or null on no-op (not a heading / empty or unchanged new text). Self-anchor updates are
 * skipped when `newText` is link-unsafe (contains | [ ] #), so a rename never writes a broken link.
 */
export function renameHeadingAt(text: string, pos: number, newText: string): HeadingChange[] | null {
  const masked = maskCodeRegions(text);
  const h = headingLineAt(text, masked, pos);
  if (!h) return null;
  // a heading (and a `[[#…]]` subpath) is single-line — collapse any newline the new text carries
  const newTrim = newText.replace(/[\r\n]+/g, " ").trim();
  if (!newTrim || newTrim === h.oldText) return null;
  const changes: HeadingChange[] = [{ from: h.textFrom, to: h.textTo, insert: newTrim }];
  if (!LINK_UNSAFE_RE.test(newTrim)) {
    const oldKey = stripHeadingText(h.oldText);
    // scan on `masked` so a `[[#x]]` literal inside code / a fence is never rewritten
    for (const a of masked.matchAll(SELF_ANCHOR_RE)) {
      const from = a.index ?? 0;
      const to = from + a[0].length;
      if (from < h.textTo && to > h.textFrom) continue; // overlaps the heading-text change → skip
      if (a[2].startsWith("^") || stripHeadingText(a[2]) !== oldKey) continue; // block ref / non-match → skip
      const subFrom = from + a[1].length + 3; // past the "(!?)" prefix + "[[#"
      changes.push({ from: subFrom, to: subFrom + a[2].length, insert: newTrim });
    }
  }
  return changes.sort((x, y) => x.from - y.from);
}
