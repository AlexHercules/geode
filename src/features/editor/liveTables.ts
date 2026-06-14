/**
 * R55 live-preview tables (#⑱) — render GFM pipe tables as real <table>s in live
 * preview, reusing the reading-view renderer (core/markdown renderMarkdownToHtml).
 * R56: the cursor-aware block-widget machinery moved to ./liveBlockWidget (shared
 * with mermaid); this file keeps the table-specific detection + widget.
 *
 * A table the selection is NOT inside is replaced by a block widget containing the
 * rendered <table>; selection inside reveals the pipe source. Clicking a rendered
 * table drops the cursor at its start to reveal the source. The document is never
 * modified — pure view layer (R55 review confirmed data-safe).
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { renderMarkdownToHtml } from "@core/markdown";
import { liveBlockWidgets } from "./liveBlockWidget";

/** Table ranges in `state` (pure — also drives the desktop probe). */
export function findTableRanges(state: EditorState): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Table") {
        out.push({ from: node.from, to: node.to });
        return false; // don't descend into cells
      }
      return undefined;
    },
  });
  return out;
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly html: string,
    readonly from: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    // html (not just source) — a cell wikilink resolving differently changes html
    // while source/from stay equal; comparing it lets a rebuild swap the stale DOM.
    return other.source === this.source && other.from === this.from && other.html === this.html;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-live-table";
    wrap.setAttribute("contenteditable", "false");
    wrap.setAttribute("data-testid", "cm-live-table");
    wrap.innerHTML = this.html;
    // click → reveal the pipe source for editing (cursor at the table start)
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return wrap;
  }

  // let the mousedown handler above run instead of CM swallowing the event
  ignoreEvent(): boolean {
    return false;
  }
}

/** The live-table extension. `getPath` resolves wikilinks inside cells. */
export function liveTables(app: GeodeApp, getPath: () => string): Extension {
  const resolve = (target: string) => app.metadata.resolveLink(target, getPath());
  return liveBlockWidgets({
    ranges: findTableRanges,
    widget: (source, from) => new TableWidget(source, renderMarkdownToHtml(source, resolve), from),
  });
}
