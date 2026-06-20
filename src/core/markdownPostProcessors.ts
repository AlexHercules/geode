/**
 * R132 — global registry of plugin-contributed markdown post-processors (reading view), backing the
 * Obsidian-compat `Plugin.registerMarkdownPostProcessor`. A post-processor transforms the RENDERED
 * reading-view DOM after the HTML lands (Dataview/Tasks flagship) — it runs on the output element,
 * NOT on the markdown→HTML byte rendering (core/markdown.ts is untouched), so this is purely
 * additive and writes no vault data.
 *
 * Layering bridge (same shape as R115 editorExtensions): compat may NOT import features (nor features
 * compat), so this CORE module is the meeting point — compat writes (register/dispose), the
 * features/editor reading view reads (`getMarkdownPostProcessors`) + subscribes to the revision and
 * applies each processor to the freshly-rendered `.preview-content` element.
 *
 * Phase 1 = reading view only; live preview (CM widgets) + registerMarkdownCodeBlockProcessor deferred.
 */
import { Store } from "./store";

/** Context handed to a post-processor. Phase-1 subset: sourcePath + frontmatter are real;
 *  getSectionInfo (DOM→source lines) and addChild (child lifecycle) are stubs — deferred. */
export interface MarkdownPostProcessorContext {
  /** unique-per-render id (phase 1: the source path) */
  docId: string;
  /** vault path of the rendered note */
  sourcePath: string;
  /** the note's parsed frontmatter, or null */
  frontmatter: unknown;
  /** the rendered reading-view container */
  containerEl: HTMLElement;
  /** phase 1 stub — section source mapping is deferred */
  getSectionInfo(el: HTMLElement): null;
  /** phase 1 stub — child component lifecycle is deferred */
  addChild(child: unknown): void;
}

export type MarkdownPostProcessor = (
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
) => void | Promise<void>;

const registered: Array<{ processor: MarkdownPostProcessor; sortOrder: number }> = [];

/** Bumped on every (un)register so each mounted reading view re-applies on the current render. */
export const markdownPostProcessorsRevision = new Store(0);

/** Register a reading-view post-processor (lower sortOrder runs first). Returns a disposer. */
export function registerMarkdownPostProcessor(
  processor: MarkdownPostProcessor,
  sortOrder = 0,
): () => void {
  const entry = { processor, sortOrder };
  registered.push(entry);
  markdownPostProcessorsRevision.update((n) => n + 1);
  return () => {
    const i = registered.indexOf(entry);
    if (i === -1) return; // already disposed — idempotent
    registered.splice(i, 1);
    markdownPostProcessorsRevision.update((n) => n + 1);
  };
}

/** Snapshot sorted by sortOrder (stable for ties — the sort preserves insertion order). */
export function getMarkdownPostProcessors(): MarkdownPostProcessor[] {
  return registered
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((e) => e.processor);
}

/**
 * R133: build the post-processor that backs Obsidian's `registerMarkdownCodeBlockProcessor` — for
 * each rendered ```<language> fence (`pre > code.language-<lang>`, the markdown-it default class)
 * it removes the `<pre>`, inserts a fresh `<div>`, and calls `handler(source, div, ctx)`. Lives in
 * core because it knows the reading-view render structure (like core/embeds.ts); built-in mermaid/
 * query fences render as `.geode-*` divs so they never match `code.language-*` (no conflict).
 */
export function makeCodeBlockPostProcessor(
  language: string,
  handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void | Promise<void>,
): MarkdownPostProcessor {
  return (el, ctx) => {
    el.querySelectorAll("pre > code").forEach((code) => {
      if (!code.classList.contains(`language-${language}`)) return;
      const pre = code.parentElement;
      if (!pre) return;
      const source = (code.textContent ?? "").replace(/\n$/, ""); // drop markdown-it's trailing \n
      const div = document.createElement("div");
      pre.replaceWith(div);
      // isolate per block (R133 review): the .catch handles an async rejection, the try/catch a SYNC
      // throw — without it a sync-throwing handler would abort the forEach + skip sibling blocks
      try {
        void Promise.resolve(handler(source, div, ctx)).catch((err) =>
          console.error(`[code-block-processor:${language}] handler rejected`, err),
        );
      } catch (err) {
        console.error(`[code-block-processor:${language}] handler threw`, err);
      }
    });
  };
}
