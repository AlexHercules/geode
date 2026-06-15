/**
 * Block-id minting (R77, ㊴) — pure logic for "copy link to block". Given a
 * note's text and a cursor offset, locate the paragraph block at the cursor and
 * return its `^id` (existing or freshly minted, with the edit to append it).
 *
 * Reuses R13's frozen block-marker contract: an id is ` ^id` at a content line's
 * end (markdown.ts/metadata.ts BLOCK_MARKER_RE). A standalone `^id` line is NOT
 * indexed by metadata, so code fences / blank lines / frontmatter cannot host a
 * resolvable id and return null (the command surfaces a notice). No .md write
 * happens here — the caller applies `edit` through the editor's normal pipeline.
 */
import { parseFrontmatter } from "./metadata";

// mirror R13 frozen marker (core/markdown.ts:200, core/metadata.ts:33): a single
// leading whitespace, `^`, then a [A-Za-z0-9-] id at end of line.
const BLOCK_MARKER_RE = /\s\^([A-Za-z0-9-]+)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

/** A short base36 id (6 chars) not present in `existing`. */
export function mintBlockId(existing: ReadonlySet<string>): string {
  let id = randomId();
  while (existing.has(id)) id = randomId();
  return id;
}

function randomId(): string {
  // accumulate base36 draws until ≥6 chars in the id charset (a short draw like
  // "0.i" must not yield a <6-char id), then take 6.
  let s = "";
  while (s.length < 6) s += Math.random().toString(36).replace(/[^a-z0-9]/g, "");
  return s.slice(0, 6);
}

export interface BlockRefEdit {
  from: number;
  to: number;
  insert: string;
}
export interface BlockRefResult {
  id: string;
  /** the edit to append ` ^id`, or null when the block already had an id */
  edit: BlockRefEdit | null;
}

/** Resolve (or mint) the block id for the paragraph at `cursorOffset`. Returns
 *  null when no block can host a resolvable id there (blank line / inside a code
 *  fence / inside frontmatter). */
export function blockRefAt(text: string, cursorOffset: number): BlockRefResult | null {
  // frontmatter is off-limits — its block id would not resolve as a body block
  const fm = parseFrontmatter(text);
  if (fm && cursorOffset < fm.to) return null;

  const lines = text.split("\n");
  const starts: number[] = [];
  let off = 0;
  for (const line of lines) {
    starts.push(off);
    off += line.length + 1;
  }

  // line the cursor sits on (clamped to the last line)
  let cur = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    if (cursorOffset < starts[i] + lines[i].length + 1) {
      cur = i;
      break;
    }
  }

  if (lines[cur].trim() === "") return null; // blank line — no block
  if (FENCE_RE.test(lines[cur])) return null; // a fence boundary line itself

  // is the cursor line inside a code fence? scan fence state from the top
  let inFence = false;
  let fenceMark = "";
  for (let i = 0; i < cur; i++) {
    if (inFence) {
      if (lines[i].trim().startsWith(fenceMark)) inFence = false;
    } else {
      const m = FENCE_RE.exec(lines[i]);
      if (m) {
        inFence = true;
        fenceMark = m[1];
      }
    }
  }
  if (inFence) return null; // code-block content can't carry a resolvable ^id

  // extend down to the block's last line (contiguous non-blank, non-fence)
  let end = cur;
  while (end + 1 < lines.length && lines[end + 1].trim() !== "" && !FENCE_RE.test(lines[end + 1])) {
    end++;
  }

  const lastLine = lines[end];
  const existingOnBlock = BLOCK_MARKER_RE.exec(lastLine);
  if (existingOnBlock) return { id: existingOnBlock[1], edit: null }; // reuse

  const used = new Set<string>();
  for (const line of lines) {
    const m = BLOCK_MARKER_RE.exec(line);
    if (m) used.add(m[1].toLowerCase()); // metadata matches ids case-insensitively
  }
  const id = mintBlockId(used);
  const insertAt = starts[end] + lastLine.length;
  return { id, edit: { from: insertAt, to: insertAt, insert: " ^" + id } };
}
