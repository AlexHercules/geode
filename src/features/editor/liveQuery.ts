/**
 * R75 live-preview query embed (㊲) — render ```query fences as live search
 * result lists in live preview, reusing the reading-view pipeline:
 * renderMarkdownToHtml emits the `.geode-query` placeholder, then hydrateEmbeds
 * runs the search and swaps in the result list. Reuses the shared cursor-aware
 * block-widget machinery (./liveBlockWidget, R55) and HydratedBlockWidget (R57).
 * The document is never modified (pure view); cursor/click into the fence reveals
 * the source, while clicks on a result's internal-link navigate (R57 widget).
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension } from "@codemirror/state";
import type { GeodeApp } from "@app/AppContext";
import { renderMarkdownToHtml } from "@core/markdown";
import { liveBlockWidgets } from "./liveBlockWidget";
import { HydratedBlockWidget } from "./liveHydratedWidget";

/** Query fence ranges in `state` (pure — also drives the desktop probe). A fence
 *  is a query iff its info string's first whitespace word is exactly "query"
 *  (case-sensitive) — mirrors core/markdown's fence renderer so the live widget
 *  and the reading-view placeholder agree on which fences are queries. */
export function findQueryRanges(state: EditorState): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode") {
        const info = node.node.getChild("CodeInfo");
        if (info && state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0] === "query") {
          out.push({ from: node.from, to: node.to });
        }
        return false; // don't descend into the fence body
      }
      return undefined;
    },
  });
  return out;
}

/** The live-query extension. `getPath` = the current note (hydrate context). */
export function liveQuery(app: GeodeApp, getPath: () => string): Extension {
  const resolve = (target: string) => app.metadata.resolveLink(target, getPath());
  return liveBlockWidgets({
    ranges: findQueryRanges,
    widget: (source, from) =>
      new HydratedBlockWidget("cm-live-query", source, renderMarkdownToHtml(source, resolve), from, app, getPath),
  });
}
