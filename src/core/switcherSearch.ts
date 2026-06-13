import type { BlockRef, HeadingRef, NoteMetadata } from "./types";
import { fuzzyMatch } from "./fuzzy";

/**
 * R38 Quick Switcher sub-modes. The Quick Switcher reads a leading sigil to pick
 * a mode (mirrors the Quick Switcher++ standalone modes):
 *   - `#query` → search HEADINGS across the vault (heading text fuzzy match)
 *   - `^query` → search BLOCKS across the vault (block id fuzzy match)
 *   - otherwise → file mode (handled in the component).
 *
 * The match logic is a PURE function over `metadata.getAll()` so the live modal,
 * the browser E2E, and the desktop probe all drive one source of truth — same
 * pattern as core/format.ts (R33) / core/bracketWrap.ts (R35). The component owns
 * only rendering + navigation (openFile + requestReveal to the hit's span).
 */

export type SwitcherMode = "file" | "heading" | "block";

export interface HeadingHit {
  path: string;
  heading: HeadingRef;
  /** fuzzy-match indices into heading.text (empty in browse mode) */
  indices: number[];
  score: number;
}

export interface BlockHit {
  path: string;
  block: BlockRef;
  /** fuzzy-match indices into block.id (empty in browse mode) */
  indices: number[];
  score: number;
}

/** Default render cap (mirrors QuickSwitcher MAX_RESULTS). */
const CAP = 100;

/** Pick the mode from the raw query's leading sigil. */
export function switcherMode(query: string): SwitcherMode {
  return query.startsWith("#") ? "heading" : query.startsWith("^") ? "block" : "file";
}

/** Strip the leading mode sigil (`#`/`^`) and surrounding space from the query. */
export function stripSigil(query: string): string {
  const mode = switcherMode(query);
  return (mode === "file" ? query : query.slice(1)).trim();
}

/** Order metadata so the active file comes first (browse-mode priority). */
function activeFirst(metas: NoteMetadata[], activeFile: string | null): NoteMetadata[] {
  if (!activeFile) return metas;
  return [...metas].sort(
    (a, b) => Number(b.path === activeFile) - Number(a.path === activeFile),
  );
}

/**
 * Vault-wide heading search. Empty query = browse (active file's headings first,
 * then the rest, capped). Non-empty = fuzzy match on heading text, score-sorted.
 */
export function searchHeadings(
  metas: NoteMetadata[],
  query: string,
  activeFile: string | null,
  cap: number = CAP,
): HeadingHit[] {
  const q = query.trim();
  if (!q) {
    const out: HeadingHit[] = [];
    for (const m of activeFirst(metas, activeFile)) {
      for (const heading of m.headings) {
        out.push({ path: m.path, heading, indices: [], score: 0 });
        if (out.length >= cap) return out;
      }
    }
    return out;
  }
  const hits: HeadingHit[] = [];
  for (const m of metas) {
    for (const heading of m.headings) {
      const fm = fuzzyMatch(q, heading.text);
      if (fm) hits.push({ path: m.path, heading, indices: fm.indices, score: fm.score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length > cap) hits.length = cap;
  return hits;
}

/**
 * Vault-wide block search (by block id — BlockRef carries no text). Empty query =
 * browse (active file first, capped). Non-empty = fuzzy match on block id.
 */
export function searchBlocks(
  metas: NoteMetadata[],
  query: string,
  activeFile: string | null,
  cap: number = CAP,
): BlockHit[] {
  const q = query.trim();
  if (!q) {
    const out: BlockHit[] = [];
    for (const m of activeFirst(metas, activeFile)) {
      for (const block of m.blocks) {
        out.push({ path: m.path, block, indices: [], score: 0 });
        if (out.length >= cap) return out;
      }
    }
    return out;
  }
  const hits: BlockHit[] = [];
  for (const m of metas) {
    for (const block of m.blocks) {
      const fm = fuzzyMatch(q, block.id);
      if (fm) hits.push({ path: m.path, block, indices: fm.indices, score: fm.score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length > cap) hits.length = cap;
  return hits;
}
