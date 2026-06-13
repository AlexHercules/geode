/**
 * Markdown formatting transforms (R33) — pure string operations, zero CM/React
 * deps. Lives in core/ (not features/) so the main.tsx `__geodeFormat` probe can
 * import it without a bootstrap→feature coupling (R28 lesson: pure decision core
 * belongs in core/). `features/editor/formatCommands.ts` wraps these in CM
 * dispatch + command registration.
 *
 * Every transform takes the full document `text` plus a selection [from, to) and
 * returns a single contiguous {@link FormatEdit} (absolute offsets) or `null`
 * for a no-op. Toggles are idempotent: applying twice round-trips to the
 * original (bold→unbold, heading cycle wraps at H6→none, fence wrap→unwrap).
 *
 * Faithfulness to Obsidian: bold/italic use `*`/`**` only (never `_`); Cmd-K
 * wraps as a markdown link `[text](url)`; toggle heading/quote/code/callout/
 * list commands exist with no default hotkey (only bold/italic/link bind keys).
 * Deliberate deviations are noted inline + in ARCHITECTURE "Round 33 additions".
 */

/** A single contiguous text replacement plus the resulting selection, all in
 *  absolute document offsets (post-edit for the selection). `null` from a
 *  transform means "no change" — callers must not dispatch. */
export interface FormatEdit {
  from: number;
  to: number;
  insert: string;
  /** selection anchor after the edit (absolute, post-edit offset) */
  selFrom: number;
  /** selection head after the edit (absolute, post-edit offset) */
  selTo: number;
}

/** The formatting operations R33 exposes as commands + probe ops. */
export type FormatOp =
  | "bold"
  | "italic"
  | "strikethrough"
  | "highlight"
  | "inline-code"
  | "link"
  | "heading"
  | "blockquote"
  | "bullet-list"
  | "numbered-list"
  | "checklist"
  | "code-block"
  | "callout";

/** Inline wrap markers (Obsidian-faithful: asterisks for emphasis, never `_`). */
const WRAP_MARKERS: Record<string, string> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  highlight: "==",
  "inline-code": "`",
};

/**
 * Toggle an inline wrap (`**`, `*`, `~~`, `==`, `` ` ``) around the selection.
 * Idempotent: if the selection (or the chars just outside it) are already the
 * marker pair, the markers are stripped; otherwise they are added. Empty
 * selection wraps to `marker|marker` with the cursor between (so the user types
 * bold text directly).
 *
 * The `emph` guard prevents the single-char `*` (italic) from grabbing one
 * asterisk out of a `**` (bold) run and vice-versa: a marker only counts as a
 * pair when the character continuing it is NOT the same emphasis char (so `*`
 * never matches inside `**`, `**` never matches inside `***`).
 */
export function toggleWrap(
  text: string,
  from: number,
  to: number,
  marker: string,
): FormatEdit | null {
  const emph = marker[0];
  const m = marker.length;
  const selected = text.slice(from, to);

  // (1) markers INSIDE the selection → unwrap
  if (
    selected.length >= 2 * m &&
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    selected[m] !== emph &&
    selected[selected.length - m - 1] !== emph
  ) {
    const inner = selected.slice(m, selected.length - m);
    return { from, to, insert: inner, selFrom: from, selTo: from + inner.length };
  }

  // (2) markers just OUTSIDE the selection → unwrap (markers were not selected)
  const before = from >= m ? text.slice(from - m, from) : "";
  const after = text.slice(to, to + m);
  if (
    before === marker &&
    after === marker &&
    text[from - m - 1] !== emph &&
    text[to + m] !== emph
  ) {
    return {
      from: from - m,
      to: to + m,
      insert: selected,
      selFrom: from - m,
      selTo: from - m + selected.length,
    };
  }

  // (3) wrap (empty selection → cursor between the markers)
  const insert = marker + selected + marker;
  return { from, to, insert, selFrom: from + m, selTo: from + m + selected.length };
}

/** Schemes that mean "this selection is already a URL" (→ `[](url)`). */
const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:)/i;

/**
 * Insert a markdown link around the selection (Cmd-K). Three cases:
 *  - empty selection → `[]()`, cursor inside the `[]` (type the label first);
 *  - selection is a URL → `[](url)`, cursor inside the `[]`;
 *  - otherwise → `[text]()`, cursor inside the `()` (type/paste the URL).
 * Always returns an edit (never a no-op). Does NOT unwrap existing links —
 * Obsidian's command is "Insert Markdown link", not a toggle.
 */
export function insertLink(text: string, from: number, to: number): FormatEdit {
  const selected = text.slice(from, to);
  if (selected.length === 0) {
    return { from, to, insert: "[]()", selFrom: from + 1, selTo: from + 1 };
  }
  if (URL_RE.test(selected)) {
    const insert = `[](${selected})`;
    return { from, to, insert, selFrom: from + 1, selTo: from + 1 };
  }
  const insert = `[${selected}]()`;
  const paren = from + 1 + selected.length + 2; // just after "[sel]("
  return { from, to, insert, selFrom: paren, selTo: paren };
}

/** Expand a selection to whole-line boundaries [start, end). When the selection
 *  ends exactly at a line boundary (a trailing newline is selected) the empty
 *  next line is NOT pulled in. */
function lineBounds(text: string, from: number, to: number): { start: number; end: number } {
  const start = text.lastIndexOf("\n", from - 1) + 1; // 0 when no preceding \n
  const effTo = to > from && text[to - 1] === "\n" ? to - 1 : to;
  let end = text.indexOf("\n", effTo);
  if (end === -1) end = text.length;
  // a selection that is exactly a trailing newline (e.g. doc "\n", select-all)
  // can push effTo before start — keep the invariant start <= end so callers
  // never build a from>to change (which would throw inside view.dispatch).
  if (end < start) end = start;
  return { start, end };
}

/** Build a whole-line FormatEdit from a transformed line block. */
function lineEdit(start: number, end: number, insert: string): FormatEdit {
  return { from: start, to: end, insert, selFrom: start, selTo: start + insert.length };
}

const INDENT_RE = /^(\s*)/;

/** Strip a leading list marker (bullet or ordered) + optional task box from a
 *  line's body (indentation already removed), so list toggles are mutually
 *  exclusive (bullet ↔ numbered ↔ checklist replace, never stack). */
function stripListMarker(body: string): string {
  return body.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "");
}

type ListKind = "bullet" | "numbered" | "checklist";

const LIST_HAS: Record<ListKind, RegExp> = {
  // a bullet that is NOT a task (task is its own kind)
  bullet: /^\s*[-*+]\s+(?!\[[ xX]\]\s)/,
  numbered: /^\s*\d+[.)]\s/,
  checklist: /^\s*[-*+]\s+\[[ xX]\]\s/,
};

/**
 * Toggle a list style across the selected lines. If every non-blank line is
 * already this kind → remove the marker from all (toggle off); otherwise apply
 * the marker to all (toggle on), replacing any other list marker first.
 * Numbered lists renumber consecutively from 1 across non-blank lines.
 */
export function toggleList(
  text: string,
  from: number,
  to: number,
  kind: ListKind,
): FormatEdit | null {
  const { start, end } = lineBounds(text, from, to);
  const lines = text.slice(start, end).split("\n");
  const has = LIST_HAS[kind];
  const nonBlank = lines.filter((l) => l.trim() !== "");
  if (nonBlank.length === 0) return null;
  const allOn = nonBlank.every((l) => has.test(l));

  let n = 0;
  const out = lines.map((line) => {
    if (line.trim() === "") return line; // leave blank lines untouched
    const indent = (line.match(INDENT_RE)?.[1]) ?? "";
    const body = line.slice(indent.length);
    if (allOn) return indent + stripListMarker(body); // toggle off
    const core = stripListMarker(body);
    n += 1;
    const marker = kind === "bullet" ? "- " : kind === "checklist" ? "- [ ] " : `${n}. `;
    return indent + marker + core;
  });
  return lineEdit(start, end, out.join("\n"));
}

/**
 * Toggle a blockquote (`> `) across the selected lines. Blockquote markers sit
 * at column 0 (Obsidian convention). All non-blank lines quoted → unquote all;
 * otherwise quote all. Blank lines inside the block are also quoted so the
 * blockquote stays contiguous when toggled on.
 */
export function toggleBlockquote(text: string, from: number, to: number): FormatEdit | null {
  const { start, end } = lineBounds(text, from, to);
  const lines = text.slice(start, end).split("\n");
  const nonBlank = lines.filter((l) => l.trim() !== "");
  if (nonBlank.length === 0) return null;
  const allQuoted = nonBlank.every((l) => /^>\s?/.test(l));
  const out = lines.map((line) => {
    if (allQuoted) return line.replace(/^>\s?/, "");
    return line === "" ? ">" : "> " + line;
  });
  return lineEdit(start, end, out.join("\n"));
}

/**
 * Cycle the heading level of the selected line(s): none → H1 → … → H6 → none.
 * The new level is derived from the FIRST non-blank line and applied to every
 * non-blank line (deliberate: a "Toggle heading" hotkey that escalates on
 * repeat is more useful than a binary none↔H1 — noted as a deviation).
 */
export function toggleHeading(text: string, from: number, to: number): FormatEdit | null {
  const { start, end } = lineBounds(text, from, to);
  const lines = text.slice(start, end).split("\n");
  const first = lines.find((l) => l.trim() !== "");
  if (first === undefined) return null;
  const curLevel = first.match(/^(#{1,6}) /)?.[1].length ?? 0;
  const newLevel = curLevel >= 6 ? 0 : curLevel + 1;
  const prefix = newLevel === 0 ? "" : "#".repeat(newLevel) + " ";
  const out = lines.map((line) => {
    if (line.trim() === "") return line;
    // strip an existing heading marker; the space is optional so a malformed
    // "#Heading" (no space) cycles to a clean "# Heading" rather than "# #Heading"
    const body = line.replace(/^#{1,6} ?/, "");
    return prefix + body;
  });
  return lineEdit(start, end, out.join("\n"));
}

/**
 * Toggle a fenced code block around the selected lines. If the block is already
 * fenced (first + last lines are ``` fences) → unwrap; otherwise wrap with
 * ```\n…\n``` and select the inner content.
 */
export function toggleCodeBlock(text: string, from: number, to: number): FormatEdit | null {
  const { start, end } = lineBounds(text, from, to);
  const block = text.slice(start, end);
  const lines = block.split("\n");
  if (lines.length >= 2 && /^```/.test(lines[0]) && /^```\s*$/.test(lines[lines.length - 1])) {
    const inner = lines.slice(1, -1).join("\n");
    return { from: start, to: end, insert: inner, selFrom: start, selTo: start + inner.length };
  }
  const insert = "```\n" + block + "\n```";
  return { from: start, to: end, insert, selFrom: start + 4, selTo: start + 4 + block.length };
}

/**
 * Toggle a `[!note]` callout around the selected lines. If the block is already
 * a callout (first line is `> [!type]…`) → unwrap (strip one `> ` level + the
 * `[!type]±` marker line); otherwise wrap with a `> [!note]` header and `> `
 * prefixes. Strips exactly ONE `> ` level on unwrap (R18 LP-2 one-level rule).
 */
export function toggleCallout(text: string, from: number, to: number): FormatEdit | null {
  const { start, end } = lineBounds(text, from, to);
  const lines = text.slice(start, end).split("\n");
  if (/^>\s*\[![A-Za-z0-9_-]+\]/.test(lines[0])) {
    const stripped = lines.map((l) => l.replace(/^>\s?/, ""));
    // drop the marker on the header line, keep any title text after it
    stripped[0] = stripped[0].replace(/^\[![A-Za-z0-9_-]+\][+-]?\s?/, "");
    const out = stripped[0] === "" ? stripped.slice(1) : stripped;
    const insert = out.join("\n");
    return { from: start, to: end, insert, selFrom: start, selTo: start + insert.length };
  }
  const body = lines.map((l) => (l === "" ? ">" : "> " + l)).join("\n");
  const insert = "> [!note]\n" + body;
  return { from: start, to: end, insert, selFrom: start, selTo: start + insert.length };
}

/**
 * Dispatch a {@link FormatOp} to its transform. The single entry point used by
 * both the editor command layer (features/editor/formatCommands.ts) and the
 * `__geodeFormat` probe (main.tsx), keeping behavior identical across them.
 */
export function applyFormatOp(
  op: FormatOp,
  text: string,
  from: number,
  to: number,
): FormatEdit | null {
  switch (op) {
    case "bold":
    case "italic":
    case "strikethrough":
    case "highlight":
    case "inline-code":
      return toggleWrap(text, from, to, WRAP_MARKERS[op]);
    case "link":
      return insertLink(text, from, to);
    case "heading":
      return toggleHeading(text, from, to);
    case "blockquote":
      return toggleBlockquote(text, from, to);
    case "bullet-list":
      return toggleList(text, from, to, "bullet");
    case "numbered-list":
      return toggleList(text, from, to, "numbered");
    case "checklist":
      return toggleList(text, from, to, "checklist");
    case "code-block":
      return toggleCodeBlock(text, from, to);
    case "callout":
      return toggleCallout(text, from, to);
  }
}
