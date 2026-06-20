/**
 * R132: apply plugin-registered markdown post-processors to a freshly-rendered reading-view DOM.
 * The reading view (EditorPane) calls this right after the embeds/code-copy hydration, on the same
 * `.preview-content` element. Reads the core registry (compat writes it via
 * Plugin.registerMarkdownPostProcessor) — neither layer imports the other. Display-only: the
 * processors transform the rendered DOM, never the source markdown (no vault write, no byte change).
 */
import type { GeodeApp } from "@app/AppContext";
import {
  getMarkdownPostProcessors,
  makeMarkdownPostProcessorContext,
  type MarkdownSectionInformation,
  RenderChildOwner,
} from "@core/markdownPostProcessors";

/** R136: map a rendered reading-view element back to its source-line range via the data-line attrs
 *  the sourcePos render emitted on top-level blocks. Returns null when `el` has no data-line ancestor
 *  (custom-rendered blocks / the container) — Obsidian-faithful "unmappable". */
function readingViewSectionInfo(el: HTMLElement, sourceText: string): MarkdownSectionInformation | null {
  // walk to the nearest BLOCK section — match on data-line-END (the sourcePos ruler's sole attr),
  // NOT data-line: the legacy task checkbox `<input data-line="N">` carries data-line without an end
  // (R136 review), so closest("[data-line]") would land on it and yield an inverted {lineStart, 0}.
  const section = el.closest("[data-line-end]");
  if (!section) return null;
  const lineStart = Number(section.getAttribute("data-line"));
  const lineEnd = Number(section.getAttribute("data-line-end"));
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd)) return null;
  return { text: sourceText, lineStart, lineEnd };
}

/** Runs reading-view post-processors and returns the owner of any children they added (R135), so the
 *  caller can `owner.unload()` them when this render is torn down. Undefined when no processors ran.
 *  `sourceText` (R136) is the render-time note source backing getSectionInfo. */
export function runMarkdownPostProcessors(
  el: HTMLElement,
  app: GeodeApp,
  sourcePath: string,
  sourceText: string,
): RenderChildOwner | undefined {
  const procs = getMarkdownPostProcessors();
  if (procs.length === 0) return undefined;
  const owner = new RenderChildOwner();
  const ctx = makeMarkdownPostProcessorContext(
    sourcePath,
    el,
    app.metadata.getMetadata(sourcePath)?.frontmatter?.fields ?? null,
    owner,
    (target) => readingViewSectionInfo(target, sourceText),
  );
  for (const proc of procs) {
    try {
      // a processor may be async (Dataview queries are) — the try/catch handles a SYNC throw; the
      // .catch handles an async rejection so a buggy processor never escapes as an unhandled rejection
      void Promise.resolve(proc(el, ctx)).catch((err) =>
        console.error("[markdown-post-processor] async processor rejected", err),
      );
    } catch (err) {
      console.error("[markdown-post-processor] processor threw", err);
    }
  }
  return owner;
}
