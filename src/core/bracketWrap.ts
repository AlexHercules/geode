/**
 * Markdown emphasis selection-wrap (R35) — a pure decision function, zero CM/React
 * deps. Lives in core/ (not features/) so the main.tsx `__geodeBrackets` probe can
 * import it without a bootstrap→feature coupling (R28/R33 lesson: pure decision
 * core belongs in core/). `features/editor/cmExtensions.ts` wraps this in a CM
 * `EditorView.inputHandler`.
 *
 * Scope split (see ARCHITECTURE "Round 35 additions"):
 *  - Brackets/quotes `( [ { " '` — auto-close + selection-wrap + type-over +
 *    Backspace-delete-pair all come from CM's built-in `closeBrackets()` (no code
 *    here). Mirrors Obsidian's "Auto pair brackets".
 *  - Markdown emphasis `* _ ` ~ = $` — selection-wrap ONLY, handled here. Mirrors
 *    Obsidian's "Auto pair Markdown syntax" for the selection case. EMPTY selection
 *    deliberately passes through (single char inserted): empty-pairing collides with
 *    line-start `* ` bullets, ``` fences and CJK input (Obsidian itself is buggy
 *    there), and selection-wrap is the form the candidate pool spelled out
 *    (candidate pool #④: "选中文本敲 括号 / 强调符 包裹").
 */

/**
 * Single-char emphasis markers that wrap a selection on keystroke. The two-char
 * forms (`**` bold, `~~` strike, `==` highlight, `$$` block math) build up by
 * pressing the key twice — each keystroke wraps one more layer because the wrap
 * keeps the inner text selected (see {@link markdownWrapInput}).
 */
export const MARKDOWN_WRAP_CHARS: ReadonlySet<string> = new Set([
  "*",
  "_",
  "`",
  "~",
  "=",
  "$",
]);

/** A bracket-wrap edit plus the resulting selection (absolute, post-edit offsets). */
export interface WrapEdit {
  changes: { from: number; to: number; insert: string };
  /** post-edit selection — still covers the inner text so a 2nd keystroke re-wraps. */
  selection: { anchor: number; head: number };
}

/**
 * Decide whether typing `ch` over the selection [from, to) in `doc` should wrap
 * that selection with a markdown emphasis marker.
 *
 * Returns the wrap edit when: the selection is NON-EMPTY (`to > from`) and `ch` is
 * a single {@link MARKDOWN_WRAP_CHARS} marker. Otherwise `null` (empty selection or
 * a non-marker char → let CM insert normally).
 *
 * The new selection is `{anchor: from + 1, head: to + 1}` — i.e. it still covers
 * the original (now inner) text, shifted right by the one opening marker. That is
 * what makes the wrap ADDITIVE: pressing `*` on a selection gives `*sel*` (sel still
 * selected), pressing `*` again gives `**sel**`.
 *
 * Pure: no CM/DOM/React. The inputHandler and the `__geodeBrackets` probe share
 * this single source of truth.
 */
export function markdownWrapInput(
  doc: string,
  from: number,
  to: number,
  ch: string,
): WrapEdit | null {
  if (to <= from) return null; // empty selection → pass through (insert single char)
  if (ch.length !== 1 || !MARKDOWN_WRAP_CHARS.has(ch)) return null;
  const selected = doc.slice(from, to);
  return {
    changes: { from, to, insert: ch + selected + ch },
    selection: { anchor: from + 1, head: to + 1 },
  };
}
