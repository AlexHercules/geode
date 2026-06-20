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
import {
  getCodeBlockProcessor,
  makeMarkdownPostProcessorContext,
  type MarkdownSectionInformation,
  RenderChildOwner,
} from "@core/markdownPostProcessors";
import { hydrateEmbeds } from "./embeds";
import { openWikilink } from "./wikilinks";

/**
 * R134 (extracted): the cursor-reveal + internal-link nav shared by every live block widget.
 * A click on a rendered internal link navigates (data-target is a resolved path → openWikilink
 * re-resolves it, never the create-note branch); any other click drops the caret into the fence
 * `from` to reveal the source for editing. preventDefault keeps the widget mounted through the
 * click. Pure view — never edits the document (only a *selection* dispatch).
 */
function attachLiveBlockReveal(
  wrap: HTMLElement,
  view: EditorView,
  from: number,
  app: GeodeApp,
  getPath: () => string,
): void {
  wrap.addEventListener("mousedown", (e) => {
    const link = (e.target as HTMLElement).closest("a.internal-link");
    if (link) {
      e.preventDefault();
      const target = link.getAttribute("data-target");
      if (target) void openWikilink(app, target, getPath());
      return;
    }
    e.preventDefault();
    view.dispatch({ selection: { anchor: from } });
    view.focus();
  });
}

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
    attachLiveBlockReveal(wrap, view, this.from, this.app, this.getPath);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** R135: the render-child owner for a live plugin code block, keyed by the widget's DOM (not the
 *  widget instance — eq() reuses one DOM across keystrokes while widget instances are rebuilt). */
const pluginWidgetOwners = new WeakMap<HTMLElement, RenderChildOwner>();

/**
 * R134 — a live-preview widget for a PLUGIN-registered code-block lang (Dataview's `dataview`,
 * Tasks' `tasks`). Unlike HydratedBlockWidget (an html placeholder + async hydrate), it hands the
 * registered handler(body, div, ctx) a fresh div to fill imperatively — the live-preview analogue of
 * the reading-view makeCodeBlockPostProcessor. Display-only: the document is never modified; cursor/
 * click reveals the fence source via the shared reveal handler.
 */
export class PluginCodeBlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly app: GeodeApp,
    readonly getPath: () => string,
  ) {
    super();
  }

  // identity = (full fence source, position): lang+body are derived from source, so equal source at
  // the same `from` ⇒ same render — CM keeps the DOM (no re-running an expensive Dataview query per
  // keystroke elsewhere in the doc).
  eq(other: PluginCodeBlockWidget): boolean {
    return other.source === this.source && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const { lang, body } = splitFence(this.source);
    const wrap = document.createElement("div");
    wrap.className = `cm-live-codeblock cm-live-codeblock-${lang}`;
    wrap.setAttribute("contenteditable", "false");
    wrap.setAttribute("data-testid", "cm-live-codeblock");
    const handler = getCodeBlockProcessor(lang);
    if (handler) {
      const path = this.getPath();
      const owner = new RenderChildOwner();
      pluginWidgetOwners.set(wrap, owner); // owner lives on the DOM (eq() reuses DOM across keystrokes)
      // R135: getSectionInfo is trivial in live preview — CM gives line numbers. Capture the immutable
      // doc + position now so a later call reflects the render-time section (text computed lazily).
      const doc = view.state.doc;
      const from = this.from;
      const newlines = (this.source.match(/\n/g) ?? []).length;
      const getSectionInfo = (): MarkdownSectionInformation => {
        const lineStart = doc.lineAt(from).number - 1;
        return { text: doc.toString(), lineStart, lineEnd: lineStart + newlines };
      };
      const ctx = makeMarkdownPostProcessorContext(
        path,
        wrap,
        this.app.metadata.getMetadata(path)?.frontmatter?.fields ?? null,
        owner,
        getSectionInfo,
      );
      // isolate like the reading-view path (R133): try/catch a SYNC throw, .catch an async rejection
      try {
        void Promise.resolve(handler(body, wrap, ctx)).catch((err) =>
          console.error(`[live-code-block:${lang}] handler rejected`, err),
        );
      } catch (err) {
        console.error(`[live-code-block:${lang}] handler threw`, err);
      }
    }
    attachLiveBlockReveal(wrap, view, this.from, this.app, this.getPath);
    return wrap;
  }

  // R135: when CM drops this widget's DOM (cursor enters the fence / fence changes), unload the
  // children the handler added so their onunload fires (Dataview cleanup). The owner lives on the dom,
  // not the widget instance, because eq() keeps one DOM across keystrokes while widgets are rebuilt.
  destroy(dom: HTMLElement): void {
    const owner = pluginWidgetOwners.get(dom);
    if (owner) {
      owner.unload();
      pluginWidgetOwners.delete(dom);
    }
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Split a FencedCode node's full source ("```lang\n…body…\n```") into its info-string lang + inner
 * body (no fences, no trailing newline) — what Obsidian hands a code-block handler, matching the
 * reading-view path (which uses the rendered `<code>` text). Detection already guarantees a
 * well-formed opening fence; an unclosed fence at EOF simply has no closing line to strip.
 */
function splitFence(source: string): { lang: string; body: string } {
  const firstNl = source.indexOf("\n");
  const openLine = firstNl === -1 ? source : source.slice(0, firstNl);
  const marker = openLine.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
  const lang = marker ? (openLine.slice(marker[0].length).trim().split(/\s+/)[0] ?? "") : "";
  if (firstNl === -1) return { lang, body: "" };
  let body = source.slice(firstNl + 1);
  // drop the trailing closing-fence line, bound to the OPENING marker char (R134 review): a ``` fence
  // isn't closed by ~~~ and vice-versa, so an unclosed fence whose last body line is the OPPOSITE
  // marker must keep it — matching the reading-view body (lezer keeps it as content).
  if (marker) {
    const fenceChar = marker[1][0]; // "`" or "~"
    body = body.replace(new RegExp(`\\n?[ \\t]{0,3}\\${fenceChar}{3,}[ \\t]*$`), "");
  }
  return { lang, body };
}
