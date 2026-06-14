/**
 * R56 live-preview mermaid (#⑱) — render ```mermaid fences as diagrams in live preview,
 * reusing the reading-view pipeline: renderMarkdownToHtml emits the `.geode-mermaid`
 * placeholder, then hydrateEmbeds async-renders the SVG (R19). Reuses the shared
 * cursor-aware block-widget machinery (./liveBlockWidget, established by R55 tables).
 *
 * R19 deferred mermaid in live preview ("fence keeps source — cross-line block widget
 * needs a StateField"); R56 is exactly that. The document is never modified (pure view);
 * cursor/click into the fence reveals the source for editing.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { renderMarkdownToHtml } from "@core/markdown";
import { hydrateEmbeds } from "./embeds";
import { liveBlockWidgets } from "./liveBlockWidget";

/** Mermaid fence ranges in `state` (pure — also drives the desktop probe). A fence is
 *  mermaid iff its info string's first whitespace word is exactly "mermaid"
 *  (case-sensitive) — mirrors core/markdown's fence renderer so the live widget and the
 *  reading-view placeholder agree on which fences are mermaid. */
export function findMermaidRanges(state: EditorState): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode") {
        const info = node.node.getChild("CodeInfo");
        if (info && state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0] === "mermaid") {
          out.push({ from: node.from, to: node.to });
        }
        return false; // don't descend into the fence body
      }
      return undefined;
    },
  });
  return out;
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly html: string,
    readonly from: number,
    readonly app: GeodeApp,
    readonly getPath: () => string,
  ) {
    super();
  }

  // source identity is enough — the placeholder html is deterministic from source, and
  // the rendered SVG lives in the reused DOM (eq=true keeps it, no re-hydrate flicker).
  eq(other: MermaidWidget): boolean {
    return other.source === this.source && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-live-mermaid";
    wrap.setAttribute("contenteditable", "false");
    wrap.setAttribute("data-testid", "cm-live-mermaid");
    wrap.innerHTML = this.html; // .geode-mermaid placeholder (source) — SVG swaps in async
    void hydrateEmbeds(wrap, this.app, this.getPath()); // R19 async render (theme-aware)
    wrap.addEventListener("mousedown", (e) => {
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

/** The live-mermaid extension. `getPath` = the current note (hydrate context). */
export function liveMermaid(app: GeodeApp, getPath: () => string): Extension {
  const resolve = (target: string) => app.metadata.resolveLink(target, getPath());
  return liveBlockWidgets({
    ranges: findMermaidRanges,
    widget: (source, from) => new MermaidWidget(source, renderMarkdownToHtml(source, resolve), from, app, getPath),
  });
}
