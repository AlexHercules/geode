/**
 * Obsidian Editor — T1.5 suite-driven subset (ARCHITECTURE.md Round 4) over a
 * host CodeMirror 6 EditorView (the shared document model's active view).
 * EditorPosition {line, ch} is 0-based on both axes.
 */
import {
  cursorCharLeft, cursorCharRight, cursorDocEnd, cursorDocStart, cursorGroupLeft, cursorGroupRight,
  cursorLineDown, cursorLineUp, deleteLine, indentLess, indentMore, insertNewlineAndIndent,
  moveLineDown, moveLineUp, redo, undo,
} from "@codemirror/commands";
import { foldAll, toggleFold, unfoldAll } from "@codemirror/language";
import { ChangeSet, EditorSelection as CMSelection } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export interface EditorPosition {
  line: number;
  ch: number;
}

/** R128: a directional selection ({anchor, head}); listSelections returns these. */
export interface EditorSelection {
  anchor: EditorPosition;
  head: EditorPosition;
}

/** R128: a positional range ({from, to}); wordAt / scrollIntoView use these. */
export interface EditorRange {
  from: EditorPosition;
  to?: EditorPosition;
}

/** R128: an {anchor, head?} where head defaults to anchor (a caret). */
export interface EditorSelectionOrCaret {
  anchor: EditorPosition;
  head?: EditorPosition;
}

/** R128: a single change in a transaction — {from, to?, text}. */
export interface EditorChange {
  from: EditorPosition;
  to?: EditorPosition;
  text: string;
}

/** R128: a batched edit — any of replaceSelection / changes / selection. */
export interface EditorTransaction {
  replaceSelection?: string;
  changes?: EditorChange[];
  selection?: EditorRange;
}

/** R128: Obsidian's exec() command names, mapped to CM6 commands in EXEC_COMMANDS. */
export type EditorCommandName =
  | "goUp" | "goDown" | "goLeft" | "goRight" | "goStart" | "goEnd"
  | "goWordLeft" | "goWordRight" | "indentMore" | "indentLess"
  | "newlineAndIndent" | "swapLineUp" | "swapLineDown" | "deleteLine"
  | "toggleFold" | "foldAll" | "unfoldAll";

// R128: Obsidian EditorCommandName → the equivalent CM6 command (view → handled?).
const EXEC_COMMANDS: Record<EditorCommandName, (view: EditorView) => boolean> = {
  goUp: cursorLineUp, goDown: cursorLineDown, goLeft: cursorCharLeft, goRight: cursorCharRight,
  goStart: cursorDocStart, goEnd: cursorDocEnd, goWordLeft: cursorGroupLeft, goWordRight: cursorGroupRight,
  indentMore, indentLess, newlineAndIndent: insertNewlineAndIndent,
  swapLineUp: moveLineUp, swapLineDown: moveLineDown, deleteLine,
  toggleFold, foldAll, unfoldAll,
};

export class Editor {
  /** @internal */
  readonly cm: EditorView;

  constructor(view: EditorView) {
    this.cm = view;
  }

  private get doc() {
    return this.cm.state.doc;
  }

  /* ----- position mapping ----- */

  posToOffset(pos: EditorPosition): number {
    const lineNo = Math.max(0, Math.min(pos.line, this.doc.lines - 1));
    const line = this.doc.line(lineNo + 1);
    return Math.max(line.from, Math.min(line.from + Math.max(0, pos.ch), line.to));
  }

  offsetToPos(offset: number): EditorPosition {
    const off = Math.max(0, Math.min(offset, this.doc.length));
    const line = this.doc.lineAt(off);
    return { line: line.number - 1, ch: off - line.from };
  }

  /* ----- content ----- */

  getValue(): string {
    return this.doc.toString();
  }

  setValue(content: string): void {
    this.cm.dispatch({ changes: { from: 0, to: this.doc.length, insert: content } });
  }

  getLine(line: number): string {
    if (line < 0 || line >= this.doc.lines) return "";
    return this.doc.line(line + 1).text;
  }

  lineCount(): number {
    return this.doc.lines;
  }

  lastLine(): number {
    return this.doc.lines - 1;
  }

  getRange(from: EditorPosition, to: EditorPosition): string {
    const a = this.posToOffset(from);
    const b = this.posToOffset(to);
    return this.cm.state.sliceDoc(Math.min(a, b), Math.max(a, b));
  }

  replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition, _origin?: string): void {
    const a = this.posToOffset(from);
    const b = to ? this.posToOffset(to) : a;
    this.cm.dispatch({
      changes: { from: Math.min(a, b), to: Math.max(a, b), insert: replacement },
    });
  }

  /* ----- selection ----- */

  getSelection(): string {
    const range = this.cm.state.selection.main;
    return this.cm.state.sliceDoc(range.from, range.to);
  }

  somethingSelected(): boolean {
    return this.cm.state.selection.ranges.some((r) => !r.empty);
  }

  replaceSelection(replacement: string): void {
    this.cm.dispatch(this.cm.state.replaceSelection(replacement));
  }

  getCursor(string?: "from" | "to" | "head" | "anchor"): EditorPosition {
    const range = this.cm.state.selection.main;
    const offset =
      string === "from"
        ? range.from
        : string === "to"
          ? range.to
          : string === "anchor"
            ? range.anchor
            : range.head;
    return this.offsetToPos(offset);
  }

  setCursor(pos: EditorPosition | number, ch?: number): void {
    const p = typeof pos === "number" ? { line: pos, ch: ch ?? 0 } : pos;
    const offset = this.posToOffset(p);
    this.cm.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
  }

  setSelection(anchor: EditorPosition, head?: EditorPosition): void {
    const a = this.posToOffset(anchor);
    const h = head ? this.posToOffset(head) : a;
    this.cm.dispatch({ selection: CMSelection.single(a, h), scrollIntoView: true });
  }

  /* ----- focus ----- */

  focus(): void {
    this.cm.focus();
  }

  hasFocus(): boolean {
    return this.cm.hasFocus;
  }

  blur(): void {
    this.cm.contentDOM.blur();
  }

  /* ----- multi-selection (R128) ----- */

  listSelections(): EditorSelection[] {
    return this.cm.state.selection.ranges.map((r) => ({
      anchor: this.offsetToPos(r.anchor),
      head: this.offsetToPos(r.head),
    }));
  }

  setSelections(ranges: EditorSelectionOrCaret[]): void {
    if (ranges.length === 0) return;
    const sel = CMSelection.create(
      ranges.map((r) => CMSelection.range(this.posToOffset(r.anchor), this.posToOffset(r.head ?? r.anchor))),
    );
    this.cm.dispatch({ selection: sel });
  }

  /* ----- line / batch edits (R128) — writes dispatch through CM → autosave (like replaceRange) ----- */

  setLine(n: number, text: string): void {
    if (n < 0 || n >= this.doc.lines) return;
    const line = this.doc.line(n + 1);
    this.cm.dispatch({ changes: { from: line.from, to: line.to, insert: text } });
  }

  transaction(tx: EditorTransaction, _origin?: string): void {
    // replaceSelection alone → the CM idiom; combined with explicit changes it's ambiguous, so
    // changes win (Obsidian callers pick one or the other). A co-supplied selection here is
    // ignored — replaceSelection sets its own caret after the inserted text (rare combo).
    if (tx.replaceSelection !== undefined && !tx.changes) {
      this.cm.dispatch(this.cm.state.replaceSelection(tx.replaceSelection));
      return;
    }
    const spec: TransactionSpec = {};
    let changes: ChangeSet | undefined;
    if (tx.changes) {
      // EditorChange positions are in the ORIGINAL doc; ChangeSet.of normalizes order/overlap itself.
      changes = ChangeSet.of(
        tx.changes.map((c) => {
          const from = this.posToOffset(c.from);
          return { from, to: c.to ? this.posToOffset(c.to) : from, insert: c.text };
        }),
        this.doc.length,
      );
      spec.changes = changes;
    }
    if (tx.selection) {
      // the selection is also in ORIGINAL-doc coords, but CM6 reads a spec's selection in NEW-doc
      // coords WITHOUT mapping it — so map through the changes ourselves (else the caret drifts by
      // the change delta, and an out-of-new-range offset throws + aborts the whole tx; R128 review).
      const map = (off: number) => (changes ? changes.mapPos(off, 1) : off);
      const anchor = map(this.posToOffset(tx.selection.from));
      spec.selection = { anchor, head: tx.selection.to ? map(this.posToOffset(tx.selection.to)) : anchor };
    }
    this.cm.dispatch(spec);
  }

  /* ----- word / scroll / history / commands (R128) ----- */

  wordAt(pos: EditorPosition): EditorRange | null {
    const word = this.cm.state.wordAt(this.posToOffset(pos));
    return word ? { from: this.offsetToPos(word.from), to: this.offsetToPos(word.to) } : null;
  }

  scrollIntoView(range: EditorRange, center?: boolean): void {
    const from = this.posToOffset(range.from);
    const to = range.to ? this.posToOffset(range.to) : from;
    this.cm.dispatch({
      effects: EditorView.scrollIntoView(CMSelection.range(from, to), { y: center ? "center" : "nearest" }),
    });
  }

  scrollTo(x?: number | null, y?: number | null): void {
    this.cm.scrollDOM.scrollTo({
      left: x ?? this.cm.scrollDOM.scrollLeft,
      top: y ?? this.cm.scrollDOM.scrollTop,
    });
  }

  getScrollInfo(): { top: number; left: number } {
    return { top: this.cm.scrollDOM.scrollTop, left: this.cm.scrollDOM.scrollLeft };
  }

  exec(command: EditorCommandName): void {
    EXEC_COMMANDS[command]?.(this.cm);
  }

  undo(): void {
    undo(this.cm);
  }

  redo(): void {
    redo(this.cm);
  }

  /** CM6 manages its own layout/measurement — nothing to refresh (CodeMirror 5 compat no-op). */
  refresh(): void {}
}
