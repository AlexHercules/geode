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
  | "wikilink"
  | "heading"
  | "blockquote"
  | "bullet-list"
  | "numbered-list"
  | "checklist"
  | "code-block"
  | "callout"
  | "toggle-task"
  // R186: set a fixed heading level (1-6) or remove the heading (Obsidian
  // "Set heading 1".."6" / "Remove heading"), vs the cycling "heading" above.
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "remove-heading"
  // R198: Obsidian "Insert inline math" / "Insert math block" / "Insert
  // horizontal rule" — pure inserts (never toggle/unwrap), so they read no
  // Lezer/overlay state and only touch the [from,to] range.
  | "inline-math"
  | "math-block"
  | "horizontal-rule"
  // R205: Obsidian "Insert table" — inserts an empty 2×2 GFM table skeleton
  // (header + body row, 2 columns) at the cursor; pure insert, never consumes
  // the selection (collapses to `to`, like horizontal-rule), reads no state.
  // Named by content (`table`) like its siblings, verb lives in the command id.
  | "table"
  // R208: Obsidian "Insert embed" — inserts `![[]]` (mirror of `wikilink` with a
  // leading `!`); pure insert, never unwraps, reads no Lezer/overlay state.
  | "embed";

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

/**
 * R189: insert an internal (wiki) link (Obsidian "Insert wikilink"):
 *  - empty selection → `[[]]`, cursor between the brackets (type/autocomplete the target);
 *  - otherwise → `[[selected]]`, cursor just after the closing `]]`.
 * Always returns an edit (never a no-op). Only the [from,to] range is replaced — bytes
 * outside the selection are untouched. Does NOT unwrap existing links (insert, not toggle).
 */
export function insertWikilink(text: string, from: number, to: number): FormatEdit {
  const selected = text.slice(from, to);
  if (selected.length === 0) {
    return { from, to, insert: "[[]]", selFrom: from + 2, selTo: from + 2 };
  }
  const insert = `[[${selected}]]`;
  const end = from + insert.length;
  return { from, to, insert, selFrom: end, selTo: end };
}

/**
 * R208: insert an embed (Obsidian "Insert embed"). Mirrors {@link insertWikilink}
 * with a leading `!`:
 *  - empty selection → `![[]]`, cursor between the brackets (`from+3`);
 *  - otherwise → `![[selected]]`, cursor just after the closing `]]`.
 * Pure insert (never unwraps); only the [from,to] range is replaced.
 */
export function insertEmbed(text: string, from: number, to: number): FormatEdit {
  const selected = text.slice(from, to);
  if (selected.length === 0) {
    return { from, to, insert: "![[]]", selFrom: from + 3, selTo: from + 3 };
  }
  const insert = `![[${selected}]]`;
  const end = from + insert.length;
  return { from, to, insert, selFrom: end, selTo: end };
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

/** A task line: `<indent><list-marker> [<state>]` where state is ANY single
 *  non-`]` char — so custom checkbox states (`[/]` in-progress, `[-]` cancelled,
 *  `[>]` …) are recognised and FLIPPED in place rather than treated as plain
 *  text (R40 review). A single char only: `[text]`/`[]` are not checkboxes. */
const TASK_BOX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([^\]])(\])/;

/**
 * Toggle the checkbox STATUS across the selected lines (Obsidian "Toggle
 * checkbox status", Cmd/Ctrl-L). Per non-blank line:
 *   - a task `… [ ] …` ↔ `… [x] …` (flip the mark; existing list marker kept);
 *   - a non-task line → an unchecked task `<indent>- [ ] <body>` (any existing
 *     bullet/ordered marker replaced — `* foo`/`1. foo`/`foo` all become
 *     `- [ ] foo`), matching Obsidian's "make it a checkbox" on first press.
 * Blank lines are left untouched WHEN the block has any non-blank line; a
 * selection/cursor that is entirely blank (e.g. an empty line) converts to
 * `<indent>- [ ] ` (Cmd+L on an empty line starts a checkbox; leading
 * whitespace is preserved, so `"   "` → `"   - [ ] "`).
 */
export function toggleTaskStatus(text: string, from: number, to: number): FormatEdit | null {
  const { start, end } = lineBounds(text, from, to);
  const lines = text.slice(start, end).split("\n");
  const anyNonBlank = lines.some((l) => l.trim() !== "");
  const out = lines.map((line) => {
    if (anyNonBlank && line.trim() === "") return line; // keep blank separators
    if (TASK_BOX_RE.test(line)) {
      // checked (x/X) → unchecked; any other state (incl. custom [/] [-] [>]) →
      // checked — matches Obsidian's "toggle checkbox status" (never malformed).
      return line.replace(TASK_BOX_RE, (_m, pre: string, mark: string, post: string) =>
        pre + (mark === "x" || mark === "X" ? " " : "x") + post,
      );
    }
    const indent = line.match(INDENT_RE)?.[1] ?? "";
    return indent + "- [ ] " + stripListMarker(line.slice(indent.length));
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
 * R186: set the selected lines' heading to a FIXED level (1-6), or remove the
 * heading (level 0). Shares toggleHeading's marker-stripping (`^#{1,6} ?`) but
 * applies a fixed level instead of cycling — Obsidian "Set heading 1".."6" /
 * "Remove heading". Returns null on no-op (already at that level) or all-blank
 * selection so the caller never dispatches a content-identical transaction.
 */
export function setHeadingLevel(
  text: string,
  from: number,
  to: number,
  level: number,
): FormatEdit | null {
  const { start, end } = lineBounds(text, from, to);
  const current = text.slice(start, end);
  const lines = current.split("\n");
  if (!lines.some((l) => l.trim() !== "")) return null;
  const prefix = level === 0 ? "" : "#".repeat(level) + " ";
  const out = lines.map((line) =>
    line.trim() === "" ? line : prefix + line.replace(/^#{1,6} ?/, ""),
  );
  const result = out.join("\n");
  if (result === current) return null;
  return lineEdit(start, end, result);
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
 * R198: insert inline math (Obsidian "Insert inline math"). Mirrors
 * {@link insertWikilink} with single-`$` wrap markers: empty selection → `$$`
 * with the cursor between (type the expression), otherwise `$selected$` with
 * the cursor after the closing `$`. Pure insert (never unwraps); only the
 * [from,to] range is replaced.
 */
export function insertInlineMath(text: string, from: number, to: number): FormatEdit {
  const selected = text.slice(from, to);
  if (selected.length === 0) {
    return { from, to, insert: "$$", selFrom: from + 1, selTo: from + 1 };
  }
  const insert = `$${selected}$`;
  const end = from + insert.length;
  return { from, to, insert, selFrom: end, selTo: end };
}

/**
 * R198: insert a `$$…$$` math block (Obsidian "Insert math block"). Mirrors
 * {@link toggleCodeBlock}'s wrap branch but is INSERT-only (never detects/
 * unwraps an existing block, so it reads no Lezer/overlay state). Wraps the
 * cursor's whole line(s); an empty line → `$$\n\n$$` with the cursor on the
 * middle line, otherwise the selected lines sit between the fences.
 */
export function insertMathBlock(text: string, from: number, to: number): FormatEdit {
  const { start, end } = lineBounds(text, from, to);
  const block = text.slice(start, end);
  const insert = "$$\n" + block + "\n$$";
  return { from: start, to: end, insert, selFrom: start + 3, selTo: start + 3 + block.length };
}

/**
 * R198: insert a horizontal rule (Obsidian "Insert horizontal rule"). The ONLY
 * insert op that does NOT consume the selection — it collapses to the selection
 * end (`to`) and inserts there, because a rule replacing selected text would
 * silently delete it (底线①). Uses `***`, not `---`: a `---` directly under
 * paragraph text is a markdown-it setext-H2 underline (semantic corruption),
 * while `***`/`___` are never setext; all three render identically as `<hr>`.
 * A leading `\n` is added only when the rule would not already start its line.
 */
export function insertHorizontalRule(text: string, _from: number, to: number): FormatEdit {
  const lead = to === 0 || text[to - 1] === "\n" ? "" : "\n";
  const insert = lead + "***\n";
  const end = to + insert.length;
  return { from: to, to, insert, selFrom: end, selTo: end };
}

/**
 * R205: insert an empty table skeleton (Obsidian "Insert table"). Like
 * {@link insertHorizontalRule} it does NOT consume the selection — it collapses
 * to `to` and inserts there, so selected text is never silently deleted (底线①).
 * Obsidian inserts a 2-column table with a header row + one body row and drops
 * the cursor in the first header cell; we mirror that with an aligned GFM
 * skeleton (cells padded to the `---` separator width). A leading `\n` is added
 * only when the table would not already start its own line. A trailing blank
 * line is added when non-blank text follows on the next line: unlike `***` a
 * GFM table is NOT self-terminating — markdown-it greedily absorbs the next
 * non-blank line as another body row, so the fence keeps it from swallowing the
 * paragraph below (reading-view fidelity; bytes are still preserved either way).
 */
export function insertTable(text: string, _from: number, to: number): FormatEdit {
  const lead = to === 0 || text[to - 1] === "\n" ? "" : "\n";
  const trail = to < text.length && text[to] !== "\n" ? "\n" : "";
  const insert = lead + "|     |     |\n| --- | --- |\n|     |     |\n" + trail;
  // cursor inside the first header cell, just past the leading "| "
  const cell = to + lead.length + 2;
  return { from: to, to, insert, selFrom: cell, selTo: cell };
}

/** R199: footnote definition-line shape — id charset mirrors `FOOTNOTE_DEF_RE`
 *  in markdown.ts:725 (`[^\s[\]]+`, no whitespace/brackets). The `[ ]{0,3}`
 *  lead mirrors the reading-view def block rule, which strips up to 3 spaces of
 *  indent (`tShift`, markdown.ts:739) before matching (4+ = indented code) — so
 *  Mode B detection agrees with what the renderer accepts as a definition. */
const FOOTNOTE_DEF_LINE_RE = /^ {0,3}\[\^([^\s[\]]+)\]:/;

/** The result of {@link insertFootnote}: either a two-site insert (ref + def) or
 *  a pure caret jump (no doc change). Offsets absolute; `selTarget` is the
 *  post-edit caret. */
export type FootnoteAction =
  | { kind: "insert"; changes: Array<{ from: number; insert: string }>; selTarget: number }
  | { kind: "jump"; selTarget: number };

/**
 * R199: Obsidian "Insert footnote" (`editor:insert-footnote`, bidirectional).
 *  - Mode B (jump): when the caret sits on a `[^id]:` DEFINITION line, jump the
 *    caret to just after the first `[^id]` REFERENCE in the body (no doc change).
 *  - Mode A (insert): otherwise insert a `[^N]` ref at the caret (N = highest
 *    existing numeric label + 1) and append a `[^N]: ` definition on the last
 *    line, leaving the caret at the end of the def marker (ready to type).
 * Mode A never deletes — both edits are insertions, so a selection is preserved
 * (the ref is added at its end `to`). max+1 numbering is collision-safe.
 */
export function insertFootnote(text: string, _from: number, to: number): FootnoteAction {
  // Mode B: caret on a definition line → jump to the first body reference
  const { start, end } = lineBounds(text, to, to);
  const defOnLine = FOOTNOTE_DEF_LINE_RE.exec(text.slice(start, end));
  if (defOnLine) {
    const ref = `[^${defOnLine[1]}]`; // literal indexOf; closing `]` blocks `[^1]`⊂`[^10]`
    for (let i = text.indexOf(ref); i !== -1; i = text.indexOf(ref, i + ref.length)) {
      if (text[i + ref.length] !== ":") return { kind: "jump", selTarget: i + ref.length };
    }
    return { kind: "jump", selTarget: to };
  }
  // Mode A: insert a new numbered footnote (ref at caret + def on the last line)
  let max = 0;
  const numRe = /\[\^(\d+)\]/g;
  for (let m = numRe.exec(text); m; m = numRe.exec(text)) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  const refInsert = `[^${max + 1}]`;
  const L = text.length;
  const leadNL = L > 0 && text[L - 1] === "\n" ? "" : "\n";
  const defInsert = `${leadNL}[^${max + 1}]: `;
  return {
    kind: "insert",
    changes: [
      { from: to, insert: refInsert },
      { from: L, insert: defInsert },
    ],
    selTarget: L + refInsert.length + defInsert.length,
  };
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
    case "wikilink":
      return insertWikilink(text, from, to);
    case "embed":
      return insertEmbed(text, from, to);
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
    case "toggle-task":
      return toggleTaskStatus(text, from, to);
    case "heading-1":
    case "heading-2":
    case "heading-3":
    case "heading-4":
    case "heading-5":
    case "heading-6":
      return setHeadingLevel(text, from, to, Number(op.slice(8)));
    case "remove-heading":
      return setHeadingLevel(text, from, to, 0);
    case "inline-math":
      return insertInlineMath(text, from, to);
    case "math-block":
      return insertMathBlock(text, from, to);
    case "horizontal-rule":
      return insertHorizontalRule(text, from, to);
    case "table":
      return insertTable(text, from, to);
    default: {
      // exhaustiveness: a new FormatOp without a case fails to compile here
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}
