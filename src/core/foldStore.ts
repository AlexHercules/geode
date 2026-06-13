/**
 * Fold persistence core (R29 — 折叠持久化 / Fold persistence).
 *
 * Pure-TS state module mirroring Obsidian's per-file fold shape but stored in
 * localStorage (NOT in the vault `.md` / `.obsidian` — zero new vault write
 * path, data-safety class B fully exempt). See ARCHITECTURE.md "Round 29
 * additions" (frozen contract).
 *
 * `FoldInfo` mirrors Obsidian's `{ folds, lines }` (0-based line ranges, no
 * heading/list/callout type tag — apply re-derives by content) so a real vault's
 * fold state could later be imported. key = `geode.fold.<path>` (same style as
 * Explorer's EXPANDED_KEY).
 *
 * All localStorage access is wrapped in try/catch (private mode / quota errors
 * degrade silently to session-only state — same idiom as Explorer.tsx /
 * core/hover.ts).
 */
import { foldedRanges } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** 0-based line range (mirrors Obsidian's FoldRange). */
export interface FoldRange {
  from: number;
  to: number;
}

/** Per-file fold state. `lines` = `doc.lines` at save time (drift reconcile). */
export interface FoldInfo {
  folds: FoldRange[];
  lines: number;
}

const KEY_PREFIX = "geode.fold.";

function keyFor(path: string): string {
  return KEY_PREFIX + path;
}

function isFoldRange(v: unknown): v is FoldRange {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as FoldRange).from === "number" &&
    typeof (v as FoldRange).to === "number"
  );
}

/** Read `geode.fold.<path>`; null on missing / parse failure / malformed shape. */
export function loadFoldInfo(path: string): FoldInfo | null {
  try {
    const raw = localStorage.getItem(keyFor(path));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as FoldInfo).folds) &&
      typeof (parsed as FoldInfo).lines === "number" &&
      (parsed as FoldInfo).folds.every(isFoldRange)
    ) {
      return parsed as FoldInfo;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist fold info. null / empty folds → removeItem (no empty key left). */
export function saveFoldInfo(path: string, info: FoldInfo | null): void {
  try {
    if (info === null || info.folds.length === 0) {
      localStorage.removeItem(keyFor(path));
      return;
    }
    localStorage.setItem(keyFor(path), JSON.stringify(info));
  } catch {
    /* private mode / quota — degrade to session-only (no persistence) */
  }
}

/** Snapshot the editor's folded ranges as a 0-based-line FoldInfo. */
export function foldInfoFromState(state: EditorState): FoldInfo {
  const folds: FoldRange[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    const fromLine = state.doc.lineAt(from).number - 1;
    const toLine = state.doc.lineAt(to).number - 1;
    folds.push({ from: fromLine, to: toLine });
  });
  return { folds, lines: state.doc.lines };
}

/**
 * Project saved 0-based line ranges back to char ranges for the current state.
 * Drops out-of-range segments (file shrank externally) — fail-safe: lose the
 * fold, never the content. No content-level reconcile this round.
 */
export function foldRangesFromInfo(
  state: EditorState,
  info: FoldInfo,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const { from, to } of info.folds) {
    // defense-in-depth: reject non-integer / negative line numbers so a tampered
    // localStorage entry can't throw RangeError out of doc.line() (loadFoldInfo
    // only checks typeof number, not >= 0). Fail-safe: drop the fold, never throw.
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) continue;
    if (from + 1 > state.doc.lines) continue; // out of range (file shrank)
    const startLine = state.doc.line(from + 1);
    const endLineNum = Math.min(to, state.doc.lines - 1) + 1;
    const endLine = state.doc.line(endLineNum);
    const charFrom = startLine.to;
    const charTo = endLine.to;
    if (charFrom < charTo) ranges.push({ from: charFrom, to: charTo });
  }
  return ranges;
}
