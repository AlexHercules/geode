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
import type { GeodeApp } from "@app/AppContext";
import { renderMarkdownToHtml } from "@core/markdown";
import { liveBlockWidgets } from "./liveBlockWidget";
import { HydratedBlockWidget } from "./liveHydratedWidget";

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

/** The live-mermaid extension. `getPath` = the current note (hydrate context). */
export function liveMermaid(app: GeodeApp, getPath: () => string): Extension {
  const resolve = (target: string) => app.metadata.resolveLink(target, getPath());
  return liveBlockWidgets({
    ranges: findMermaidRanges,
    widget: (source, from) =>
      new HydratedBlockWidget("cm-live-mermaid", source, renderMarkdownToHtml(source, resolve), from, app, getPath),
  });
}
