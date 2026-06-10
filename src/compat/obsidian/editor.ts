/**
 * Obsidian Editor — T1.5 suite-driven subset (ARCHITECTURE.md Round 4) over a
 * host CodeMirror 6 EditorView (the shared document model's active view).
 * EditorPosition {line, ch} is 0-based on both axes.
 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface EditorPosition {
  line: number;
  ch: number;
}

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
    this.cm.dispatch({ selection: EditorSelection.single(a, h), scrollIntoView: true });
  }

  /* ----- focus ----- */

  focus(): void {
    this.cm.focus();
  }

  hasFocus(): boolean {
    return this.cm.hasFocus;
  }
}
