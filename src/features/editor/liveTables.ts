/**
 * R55 live-preview tables (#⑱) — render GFM pipe tables as real <table>s in live
 * preview, reusing the reading-view renderer (core/markdown renderMarkdownToHtml).
 *
 * Model: a ViewPlugin scans the lezer `Table` nodes in the viewport and, for every
 * table the selection is NOT inside, REPLACES its source lines with a block widget
 * containing the rendered table. When the selection intersects a table's range the
 * widget is dropped so the raw pipe source shows for editing — Geode's first
 * cursor-aware block widget (the "block-level cross-line replace needs a StateField /
 * viewport plugin" gap noted in ARCHITECTURE R18). Clicking a rendered table dispatches
 * the cursor to its start, which reveals the source on the next update.
 *
 * Data-safety: the decoration is a VIEW concern only — the document is never modified;
 * the pipe source always lives in the doc and is one selection away from editing. The
 * widget's only side effect is a selection dispatch (no doc change).
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { renderMarkdownToHtml } from "@core/markdown";

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

function buildTableDecos(state: EditorState, app: GeodeApp, getPath: () => string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = state.selection.ranges;
  const resolve = (target: string) => app.metadata.resolveLink(target, getPath());
  // findTableRanges yields document-order ranges (RangeSetBuilder needs ascending from)
  for (const { from, to } of findTableRanges(state)) {
    // R55 review (major): a block-replace decoration MUST be line-aligned. A Table
    // inside a blockquote / list / indentation has node.from mid-line (after the `>`
    // or indent) → a mid-line block widget corrupts the view. Skip those — they keep
    // their pipe source (nested-table live render is out of scope this round).
    if (from !== state.doc.lineAt(from).from) continue;
    // reveal (no widget) when any cursor/selection touches the table — keeps the pipe
    // source editable; one click (TableWidget) drops the cursor here to reveal it.
    const inside = ranges.some((r) => r.from <= to && r.to >= from);
    if (inside) continue;
    const source = state.sliceDoc(from, to);
    const html = renderMarkdownToHtml(source, resolve);
    builder.add(from, to, Decoration.replace({ widget: new TableWidget(source, html, from), block: true }));
  }
  return builder.finish();
}

/** The live-table extension: a StateField of block-replace widgets + atomicRanges so
 *  the caret treats a rendered table as a unit (it can't park invisibly inside the
 *  replaced range — mirrors the frontmatter field, R22). Block decorations MUST come
 *  from a StateField, not a ViewPlugin (CM constraint). Rebuilds on doc/selection
 *  change so entering/leaving a table toggles render↔source. `getPath` resolves
 *  wikilinks in cells. */
export function liveTables(app: GeodeApp, getPath: () => string): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildTableDecos(state, app, getPath),
    update: (value, tr) => {
      if (tr.docChanged || tr.selection) return buildTableDecos(tr.state, app, getPath);
      return value.map(tr.changes);
    },
    provide: (f) => [
      EditorView.decorations.from(f),
      EditorView.atomicRanges.of((view) => view.state.field(f, false) ?? Decoration.none),
    ],
  });
  return field;
}
