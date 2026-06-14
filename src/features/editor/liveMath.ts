/**
 * R57 live-preview display math (#⑱) — render `$$…$$` blocks as KaTeX in live preview,
 * reusing the reading-view pipeline: renderMarkdownToHtml emits the `.geode-math-block`
 * placeholder, then hydrateEmbeds (math pass) renders it with KaTeX (R18). Reuses the
 * shared cursor-aware block-widget machinery + HydratedBlockWidget (R55/R56).
 *
 * lezer-markdown has NO `$$` node, so the ranges come from a line-scan that mirrors
 * core/markdown's block-math rule — but each candidate is then CONFIRMED by the renderer
 * (the slice must render to a `geode-math-block`), so the live widget can never disagree
 * with what the reading view renders (R56 lesson: detector == renderer). Pure view layer;
 * cursor/click into the block reveals the source for editing.
 */
import { type EditorState, type Extension } from "@codemirror/state";
import type { GeodeApp } from "@app/AppContext";
import { renderMarkdownToHtml } from "@core/markdown";
import { liveBlockWidgets } from "./liveBlockWidget";
import { HydratedBlockWidget } from "./liveHydratedWidget";

const FENCE_RE = /^(`{3,}|~{3,})/;

/** Display-math (`$$…$$`) block ranges in `state` (pure — also drives the desktop probe).
 *  The line-scan proposes candidates (mirroring core/markdown's opener/closer/inner-close
 *  rules); renderMarkdownToHtml then confirms each before it becomes a range. */
export function findMathBlockRanges(state: EditorState): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const doc = state.doc;
  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);
    const text = line.text;
    const indent = text.length - text.trimStart().length;
    const trimmed = text.trim();
    // R57 review (D1): require a TRUE top-level opener (no leading indent). The range
    // always starts at line.from, so the shared line-start guard can't catch an
    // indented `$$` (e.g. inside a list item) — that would widget-ize nested math while
    // tables/mermaid (lezer nodes, mid-line `from`) correctly degrade to source.
    // Indented (1-3) math still renders in the reading view; in live it shows source.
    if (indent !== 0 || !trimmed.startsWith("$$")) { i++; continue; }
    const rest = trimmed.slice(2).trimEnd(); // content after the opening `$$`
    // a `$$` on the opener that is NOT the trailing closer (e.g. `$$x$$ foo`) → not a block
    const innerClose = rest.indexOf("$$");
    if (innerClose >= 0 && innerClose !== rest.length - 2) { i++; continue; }
    let endLine = -1;
    if (rest.endsWith("$$")) {
      endLine = i; // single-line `$$x$$`
    } else {
      // scan forward for a line ending in `$$`, bailing at a code-fence opener
      for (let ln = i + 1; ln <= doc.lines; ln++) {
        const lt = doc.line(ln).text;
        const lind = lt.length - lt.trimStart().length;
        if (lind <= 3 && FENCE_RE.test(lt.trim())) break;
        if (lt.trimEnd().endsWith("$$")) { endLine = ln; break; }
      }
    }
    if (endLine < 0) { i++; continue; }
    const from = line.from;
    const to = doc.line(endLine).to;
    // confirm with the renderer (authority) — skips any exotic scan/render divergence
    if (renderMarkdownToHtml(doc.sliceString(from, to), () => null).includes("geode-math-block")) {
      out.push({ from, to });
      i = endLine + 1;
    } else {
      i++;
    }
  }
  return out;
}

/** The live-math extension. `getPath` = the current note (hydrate context). */
export function liveMath(app: GeodeApp, getPath: () => string): Extension {
  const resolve = (target: string) => app.metadata.resolveLink(target, getPath());
  return liveBlockWidgets({
    ranges: findMathBlockRanges,
    widget: (source, from) =>
      new HydratedBlockWidget("cm-live-math", source, renderMarkdownToHtml(source, resolve), from, app, getPath),
  });
}
