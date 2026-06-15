/**
 * R57 — a live-preview block widget whose body is rendered by the reading-view pipeline
 * AND then asynchronously hydrated (mermaid SVG / KaTeX math). Shared by liveMermaid
 * (R56) and liveMath (R57): both emit a `.geode-*` placeholder via renderMarkdownToHtml
 * and let hydrateEmbeds swap in the rendered output. The only per-feature difference is
 * the wrapper class / testid, so they reuse this one widget (R56 lesson: extract on the
 * second use). Pure view layer — the document is never modified; click reveals the
 * source for editing.
 */
import { EditorView, WidgetType } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { hydrateEmbeds } from "./embeds";
import { openWikilink } from "./wikilinks";

export class HydratedBlockWidget extends WidgetType {
  constructor(
    readonly cls: string,
    readonly source: string,
    readonly html: string,
    readonly from: number,
    readonly app: GeodeApp,
    readonly getPath: () => string,
  ) {
    super();
  }

  // source identity is enough — the placeholder html is deterministic from source, and
  // the hydrated output lives in the reused DOM (eq=true keeps it, no re-hydrate flicker).
  eq(other: HydratedBlockWidget): boolean {
    return other.cls === this.cls && other.source === this.source && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = this.cls;
    wrap.setAttribute("contenteditable", "false");
    wrap.setAttribute("data-testid", this.cls);
    wrap.innerHTML = this.html; // .geode-mermaid / .geode-math placeholder — output swaps in async
    void hydrateEmbeds(wrap, this.app, this.getPath());
    wrap.addEventListener("mousedown", (e) => {
      // R75: a click on a rendered internal link (e.g. a query result row, a
      // mermaid node, a link in a live table) navigates instead of entering edit
      // mode. data-target is a resolved path → openWikilink re-resolves it (never
      // the create-note branch). preventDefault keeps the widget mounted so the
      // link isn't torn out before navigation.
      const link = (e.target as HTMLElement).closest("a.internal-link");
      if (link) {
        e.preventDefault();
        const target = link.getAttribute("data-target");
        if (target) void openWikilink(this.app, target, this.getPath());
        return;
      }
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
