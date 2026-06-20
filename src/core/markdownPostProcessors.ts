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

/** The source-line range a rendered element maps back to (Obsidian MarkdownSectionInformation). */
export interface MarkdownSectionInformation {
  /** the FULL note source text */
  text: string;
  /** 0-based first line of the section */
  lineStart: number;
  /** 0-based last line of the section */
  lineEnd: number;
}

/** R135: structural shape of a child component (compat MarkdownRenderChild satisfies it via Component's
 *  load/unload). Kept structural because core must not import compat. */
export interface RenderChild {
  load(): void;
  unload(): void;
}

/**
 * R135: collects the children a post-processor adds for ONE render and tears them down together.
 * The feature side (reading-view effect / live widget) owns it and calls `unload()` when that render
 * is torn down (re-render / view close / widget destroyed) — giving addChild a real lifecycle without
 * core importing compat's Component. addChild loads immediately (Obsidian: a child added to a loaded
 * parent loads now).
 */
export class RenderChildOwner {
  private readonly children: RenderChild[] = [];
  /** the owner is an already-loaded parent until unload() runs (terminal). */
  private loaded = true;
  addChild(child: RenderChild): void {
    if (this.children.includes(child)) return; // idempotent, like Component.addChild
    this.children.push(child);
    // R135 review (MAJOR): a handler may call addChild AFTER an await — by then this render may be torn
    // down. Loading into a dead owner leaks a child that never unloads (mirrors Component's `if loaded`).
    if (this.loaded) child.load();
  }
  unload(): void {
    this.loaded = false; // terminal: a late addChild no longer loads
    // reverse order + per-child isolation; splice empties so a second unload is a no-op
    for (const child of this.children.splice(0).reverse()) {
      try {
        child.unload();
      } catch (err) {
        console.error("[markdown-render-child] unload threw", err);
      }
    }
  }
}

/** Context handed to a post-processor. `getSectionInfo` is real for live preview (CM line info) and
 *  null for reading view (DOM→source-line mapping needs a markdown.ts data-line change = §C, deferred);
 *  `addChild` is real (R135) — children load on add and unload when the render is torn down. */
export interface MarkdownPostProcessorContext {
  /** unique-per-render id (phase 1: the source path) */
  docId: string;
  /** vault path of the rendered note */
  sourcePath: string;
  /** the note's parsed frontmatter, or null */
  frontmatter: unknown;
  /** the rendered reading-view container */
  containerEl: HTMLElement;
  /** source-line range of the section `el` belongs to, or null when unmappable */
  getSectionInfo(el: HTMLElement): MarkdownSectionInformation | null;
  /** register a child component whose onunload fires when this render is torn down */
  addChild(child: RenderChild): void;
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

export type CodeBlockProcessor = (
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
) => void | Promise<void>;

/**
 * R134: a lang→handler map for code-block processors, so the LIVE PREVIEW (CM widget) side can ask
 * "is there a handler for fence lang X" — R133 only stored handlers as opaque post-processors (lang
 * closed over, invisible to the registry), which the live-preview fence detector can't query. Both
 * paths now read one source of truth: reading view via the post-processor (unchanged), live preview
 * via this map. last-writer-wins per lang (Obsidian renders one processor per fence lang).
 */
const codeBlockProcessors = new Map<string, CodeBlockProcessor>();

/** Bumped on every (un)register so open live editors re-evaluate which fences become widgets. */
export const codeBlockProcessorsRevision = new Store(0);

export function getCodeBlockProcessor(language: string): CodeBlockProcessor | undefined {
  return codeBlockProcessors.get(language);
}

export function hasCodeBlockProcessor(language: string): boolean {
  return codeBlockProcessors.has(language);
}

/**
 * R134: the single dual-registration point behind `Plugin.registerMarkdownCodeBlockProcessor`.
 * Registers ONE (lang, handler) into BOTH the reading-view post-processor list (R133, via
 * makeCodeBlockPostProcessor) AND the lang→handler map (live preview), returning the
 * Obsidian-shaped `processor` plus a `dispose` that tears down both. compat + the E2E hook both
 * call this so the dual bookkeeping lives in exactly one place.
 */
export function registerCodeBlockProcessor(
  language: string,
  handler: CodeBlockProcessor,
  sortOrder = 0,
): { processor: MarkdownPostProcessor; dispose: () => void } {
  const processor = makeCodeBlockPostProcessor(language, handler);
  const disposePost = registerMarkdownPostProcessor(processor, sortOrder);
  codeBlockProcessors.set(language, handler);
  codeBlockProcessorsRevision.update((n) => n + 1);
  const dispose = () => {
    disposePost();
    // identity guard: a later register of the same lang must not be clobbered by an old disposer
    if (codeBlockProcessors.get(language) === handler) {
      codeBlockProcessors.delete(language);
      codeBlockProcessorsRevision.update((n) => n + 1);
    }
  };
  return { processor, dispose };
}

/**
 * R134: build the context handed to a markdown post-processor / code-block handler. One factory for
 * both the reading-view path (markdownPostProcess) and the live-preview widget, so the phase-1 stubs
 * (getSectionInfo / addChild) have a single definition to upgrade in phase 2.
 */
export function makeMarkdownPostProcessorContext(
  sourcePath: string,
  containerEl: HTMLElement,
  frontmatter: unknown,
  owner: RenderChildOwner,
  getSectionInfo: (el: HTMLElement) => MarkdownSectionInformation | null = () => null,
): MarkdownPostProcessorContext {
  return {
    docId: sourcePath,
    sourcePath,
    frontmatter,
    containerEl,
    getSectionInfo,
    addChild: (child) => owner.addChild(child),
  };
}
