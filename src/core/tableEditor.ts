/**
 * R206: GFM table structural editing (Obsidian §17 table editor, 片 A — insert/
 * delete row & column). Pure model: parse a pipe table → {header, aligns, rows},
 * apply a structural op, serialize back to GFM. The command layer (features/
 * editor/tableCommands.ts) finds the cursor's Table range via the vetted R55
 * `findTableRanges` (Lezer Table node, so code fences are excluded) and feeds the
 * raw slice here.
 *
 * CRITICAL — cell tokenization MUST agree with the reading view. Geode renders
 * tables through markdown-it (core/markdown.ts), whose table rule splits cells
 * with `escapedSplit` (split on unescaped `|`, `\|` is a literal pipe, NO
 * code-span exception). We replicate that byte-for-byte so the editor's column
 * model matches what actually renders — the recurring "detector must align with
 * the reading view" discipline (R201/R204/R205). A divergent split would corrupt.
 */

export type TableOp =
  | "insert-row-above"
  | "insert-row-below"
  | "insert-column-left"
  | "insert-column-right"
  | "delete-row"
  | "delete-column";

export type ColumnAlign = "none" | "left" | "right" | "center";

export interface TableModel {
  /** Header cells (trimmed). `header.length` is the authoritative column count. */
  header: string[];
  /** Per-column alignment; `aligns.length === header.length`. */
  aligns: ColumnAlign[];
  /** Body rows, each padded to the column count. A ragged row is never truncated —
   *  an extra cell widens the table (header/aligns padded) so no content is dropped (底线①). */
  rows: string[][];
}

/** Cursor cell. `bodyRow === -1` means the header or delimiter line. */
export interface CellPos {
  col: number;
  bodyRow: number;
}

/**
 * markdown-it's exact table cell tokenizer (lib/rules_block/table.js): split on
 * `|`, where a `\|` is folded to a literal pipe inside the current cell. No
 * code-span exception — this is intentional parity with the renderer.
 */
function escapedSplit(str: string): string[] {
  const result: string[] = [];
  const max = str.length;
  let pos = 0;
  let isEscaped = false;
  let lastPos = 0;
  let current = "";
  let ch = str.charCodeAt(pos);
  while (pos < max) {
    if (ch === 0x7c /* | */) {
      if (!isEscaped) {
        result.push(current + str.slice(lastPos, pos));
        current = "";
        lastPos = pos + 1;
      } else {
        current += str.slice(lastPos, pos - 1);
        lastPos = pos;
      }
    }
    isEscaped = ch === 0x5c /* \ */;
    pos++;
    ch = str.charCodeAt(pos);
  }
  result.push(current + str.slice(lastPos));
  return result;
}

/** Split one table line into trimmed cells, dropping the empty ends from outer pipes. */
function splitRow(line: string): string[] {
  const cells = escapedSplit(line.trim());
  if (cells.length && cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/** Parse one delimiter cell (`:?-+:?`) into an alignment, or null if not a delimiter. */
function parseAlign(cell: string): ColumnAlign | null {
  const t = cell.trim();
  if (!/^:?-+:?$/.test(t)) return null;
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

/**
 * True if any `|` sits inside a Geode overlay (wikilink/embed `[[…]]`/`![[…]]`,
 * inline code `` `…` ``, inline math `$…$`). The reading view treats those as
 * atomic (the wikilink pre-pass in markdown.ts removes the pipe before the table
 * rule runs), but our markdown-it-style escapedSplit would split on it — so a
 * cell like `[[Page|Alias]]` would be torn across a column boundary on edit
 * (底线①). We refuse to edit such a table (caller no-ops) rather than corrupt it.
 * This is the table instance of "the editor must agree with the reading view"
 * (R192/R201/R204). Overlay-aware EDITING (preserving these cells) is a follow-on.
 */
function hasOverlayPipe(text: string): boolean {
  const stripped = text
    .replace(/!?\[\[[^\]]*\]\]/g, "") // wikilink / embed
    .replace(/`[^`]*`/g, "") // inline code
    // inline math, aligned with the reading view (markdown.ts:899): open `$` hugs
    // non-ws, close `$` is NOT followed by a digit (so currency `$5 | $10` is plain
    // text, not a pipe-hiding overlay). `\\.` consumes an escaped char atomically and
    // the content class excludes `\` so a `\$` can never be split into `\`+closing-$.
    .replace(/\$(?=\S)(?:\\.|[^$\\\n])*?\$(?!\d)/g, "");
  const pipes = (s: string) => (s.match(/\|/g) || []).length;
  return pipes(text) > pipes(stripped);
}

/** Parse a raw pipe-table slice into a model, or null if it isn't a valid GFM table. */
export function parseTable(text: string): TableModel | null {
  if (hasOverlayPipe(text)) return null; // a pipe inside a wikilink/code/math cell — refuse (don't corrupt)
  const lines = text.split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const delimCells = splitRow(lines[1]);
  if (header.length === 0 || delimCells.length !== header.length) return null;
  const aligns: ColumnAlign[] = [];
  for (const d of delimCells) {
    const a = parseAlign(d);
    if (a === null) return null;
    aligns.push(a);
  }
  const bodyCells: string[][] = [];
  let ncols = header.length;
  for (let i = 2; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const cells = splitRow(lines[i]);
    ncols = Math.max(ncols, cells.length);
    bodyCells.push(cells);
  }
  // Pad header + aligns to the widest row so a ragged table never DROPS a body
  // cell on edit (底线① — markdown-it ignores extras at render time, but we must
  // not lose them from the source). Short rows are padded with empty cells.
  while (header.length < ncols) header.push("");
  while (aligns.length < ncols) aligns.push("none");
  const rows = bodyCells.map((cells) => {
    const row: string[] = [];
    for (let c = 0; c < ncols; c++) row.push(cells[c] ?? "");
    return row;
  });
  return { header, aligns, rows };
}

const ALIGN_DELIM: Record<ColumnAlign, string> = {
  none: " --- ",
  left: " :-- ",
  right: " --: ",
  center: " :-: ",
};

/**
 * A cell rendered for output: surrounded by single spaces, with any literal `|`
 * re-escaped to `\|`. The model stores UNescaped content (escapedSplit folds
 * `\|`→`|` on parse), so without this an in-cell pipe would reparse as a column
 * break = corruption (底线①).
 */
function renderCell(c: string): string {
  return ` ${c.replace(/\|/g, "\\|")} `;
}

function buildRow(cells: string[]): string {
  return "|" + cells.map(renderCell).join("|") + "|";
}

function buildDelim(aligns: ColumnAlign[]): string {
  return "|" + aligns.map((a) => ALIGN_DELIM[a]).join("|") + "|";
}

/** Offset of cell `col`'s content start within a row built by `buildRow`. */
function cellContentOffsetInRow(cells: string[], col: number): number {
  let off = 1; // leading "|"
  for (let k = 0; k < col; k++) off += renderCell(cells[k]).length + 1; // cell + "|"
  return off + 1; // leading space of cell `col`
}

/**
 * Serialize a model to GFM (single-space-padded cells; delimiter from aligns).
 * No trailing newline. When `focus` is given, `cursorOffset` is the content-start
 * offset of that cell in the produced text (for placing the caret post-edit).
 */
export function serializeTable(model: TableModel, focus?: CellPos): { text: string; cursorOffset: number } {
  const lines: string[] = [buildRow(model.header), buildDelim(model.aligns)];
  for (const r of model.rows) lines.push(buildRow(r));
  const text = lines.join("\n");
  let cursorOffset = 0;
  if (focus) {
    const lineIndex = focus.bodyRow < 0 ? 0 : 2 + focus.bodyRow;
    const safeLine = Math.min(Math.max(lineIndex, 0), lines.length - 1);
    let off = 0;
    for (let i = 0; i < safeLine; i++) off += lines[i].length + 1; // + "\n"
    const cells = focus.bodyRow < 0 ? model.header : model.rows[focus.bodyRow] ?? model.header;
    const col = Math.min(Math.max(focus.col, 0), cells.length - 1);
    cursorOffset = off + cellContentOffsetInRow(cells, col);
  }
  return { text, cursorOffset };
}

/** Locate the cursor cell from an offset relative to the table text. */
export function locateCell(text: string, offset: number): CellPos | null {
  if (offset < 0) return null;
  let lineStart = 0;
  let lineIndex = 0;
  const stop = Math.min(offset, text.length);
  for (let i = 0; i < stop; i++) {
    if (text[i] === "\n") {
      lineIndex++;
      lineStart = i + 1;
    }
  }
  const bodyRow = lineIndex <= 1 ? -1 : lineIndex - 2;
  // count unescaped pipes in [lineStart, offset)
  let col = 0;
  let isEscaped = false;
  for (let i = lineStart; i < stop; i++) {
    const ch = text[i];
    if (ch === "\n") break;
    if (ch === "|" && !isEscaped) col++;
    isEscaped = ch === "\\";
  }
  // a leading pipe doesn't open a new column → don't count it
  let fns = lineStart;
  while (fns < text.length && (text[fns] === " " || text[fns] === "\t")) fns++;
  if (text[fns] === "|") col = Math.max(0, col - 1);
  return { col, bodyRow };
}

function emptyRow(n: number): string[] {
  return Array.from({ length: n }, () => "");
}

function insertColAt(model: TableModel, at: number): TableModel {
  const header = model.header.slice();
  header.splice(at, 0, "");
  const aligns = model.aligns.slice();
  aligns.splice(at, 0, "none");
  const rows = model.rows.map((r) => {
    const nr = r.slice();
    nr.splice(at, 0, "");
    return nr;
  });
  return { header, aligns, rows };
}

interface OpResult {
  model: TableModel;
  focus: CellPos;
}

function applyOp(op: TableOp, model: TableModel, pos: CellPos): OpResult | null {
  switch (op) {
    case "insert-row-above": {
      const at = pos.bodyRow < 0 ? 0 : pos.bodyRow;
      const rows = model.rows.slice();
      rows.splice(at, 0, emptyRow(model.header.length));
      return { model: { ...model, rows }, focus: { col: pos.col, bodyRow: at } };
    }
    case "insert-row-below": {
      const at = pos.bodyRow < 0 ? 0 : pos.bodyRow + 1;
      const rows = model.rows.slice();
      rows.splice(at, 0, emptyRow(model.header.length));
      return { model: { ...model, rows }, focus: { col: pos.col, bodyRow: at } };
    }
    case "insert-column-left": {
      const at = pos.col;
      return { model: insertColAt(model, at), focus: { col: at, bodyRow: pos.bodyRow } };
    }
    case "insert-column-right": {
      const at = pos.col + 1;
      return { model: insertColAt(model, at), focus: { col: at, bodyRow: pos.bodyRow } };
    }
    case "delete-row": {
      if (pos.bodyRow < 0) return null; // header/delimiter — nothing to delete
      const rows = model.rows.slice();
      rows.splice(pos.bodyRow, 1);
      const focusBody = rows.length === 0 ? -1 : Math.min(pos.bodyRow, rows.length - 1);
      return { model: { ...model, rows }, focus: { col: pos.col, bodyRow: focusBody } };
    }
    case "delete-column": {
      if (model.header.length <= 1) return null; // never leave 0 columns
      const at = pos.col;
      const header = model.header.slice();
      header.splice(at, 1);
      const aligns = model.aligns.slice();
      aligns.splice(at, 1);
      const rows = model.rows.map((r) => {
        const nr = r.slice();
        nr.splice(at, 1);
        return nr;
      });
      return { model: { header, aligns, rows }, focus: { col: Math.min(at, header.length - 1), bodyRow: pos.bodyRow } };
    }
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/**
 * Command-layer entry (mirrors applyFormatOp): parse the table slice, locate the
 * cursor cell, apply the op, re-serialize. Returns the new table text + the
 * caret offset within it, or null if the cursor isn't in a valid table or the op
 * is a no-op (delete last column / delete a header "row").
 */
export function applyTableOp(
  op: TableOp,
  tableText: string,
  offset: number,
): { text: string; cursorOffsetInTable: number } | null {
  const model = parseTable(tableText);
  if (!model) return null;
  const raw = locateCell(tableText, offset);
  if (!raw) return null;
  const ncols = model.header.length;
  const pos: CellPos = {
    col: Math.min(Math.max(raw.col, 0), ncols - 1),
    bodyRow: raw.bodyRow < 0 || model.rows.length === 0 ? -1 : Math.min(raw.bodyRow, model.rows.length - 1),
  };
  const result = applyOp(op, model, pos);
  if (!result) return null;
  const ser = serializeTable(result.model, result.focus);
  return { text: ser.text, cursorOffsetInTable: ser.cursorOffset };
}
