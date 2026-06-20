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
} from "@core/markdownPostProcessors";

export function runMarkdownPostProcessors(el: HTMLElement, app: GeodeApp, sourcePath: string): void {
  const procs = getMarkdownPostProcessors();
  if (procs.length === 0) return;
  const ctx = makeMarkdownPostProcessorContext(
    sourcePath,
    el,
    app.metadata.getMetadata(sourcePath)?.frontmatter?.fields ?? null,
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
}
