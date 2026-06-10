/**
 * CodeMirror 6 extension stack for the Geode markdown editor:
 * theme + markdown highlighting, wikilink/tag decorations, click-to-navigate
 * and [[ autocomplete. Undo history and the doc-changed/auto-save listener
 * live in the shared DocumentHandle (core/documents.ts) — NOT here — so that
 * one history + one save exist per file regardless of pane count.
 * The file path is passed as a GETTER because file:renamed retargets the
 * document in place without rebuilding the view.
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  MatchDecorator,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { GeodeApp } from "@app/AppContext";
import { livePreview } from "./livePreview";
import { openWikilink, wikilinkTarget } from "./wikilinks";

/** Dispatched when the metadata index changes so wikilink resolution re-runs. */
export const refreshWikilinks = StateEffect.define<null>();

/* ---------------- theme ---------------- */

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--text-normal)",
    fontSize: "var(--editor-font-size)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.65", overflow: "auto" },
  ".cm-content": {
    padding: "28px 0 45vh",
    maxWidth: "46em",
    margin: "0 auto",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0 32px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  ".cm-content ::selection": { background: "var(--selection)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    { background: "var(--selection)" },
  ".cm-placeholder": { color: "var(--text-faint)" },
  ".cm-tooltip": {
    background: "var(--bg-modal)",
    border: "1px solid var(--border-strong)",
    borderRadius: "8px",
    boxShadow: "var(--shadow-modal)",
    color: "var(--text-normal)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "inherit", maxHeight: "264px" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "4px 10px", lineHeight: "1.45" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "var(--accent-muted)",
    color: "var(--text-normal)",
  },
  ".cm-completionDetail": {
    color: "var(--text-faint)",
    fontStyle: "normal",
    marginLeft: "10px",
    fontSize: "0.85em",
  },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--accent)" },
});

/* ---------------- markdown highlight style (live-preview feel) ---------------- */

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, class: "cm-md-h1" },
  { tag: t.heading2, class: "cm-md-h2" },
  { tag: t.heading3, class: "cm-md-h3" },
  { tag: [t.heading4, t.heading5, t.heading6], class: "cm-md-h4" },
  { tag: t.strong, class: "cm-md-strong" },
  { tag: t.emphasis, class: "cm-md-em" },
  { tag: t.strikethrough, class: "cm-md-strike" },
  { tag: t.monospace, class: "cm-md-code" },
  { tag: t.quote, class: "cm-md-quote" },
  { tag: t.link, class: "cm-md-link" },
  { tag: t.url, class: "cm-md-url" },
  { tag: t.processingInstruction, class: "cm-md-mark" },
  { tag: t.labelName, class: "cm-md-mark" },
  { tag: t.contentSeparator, class: "cm-md-hr" },
  // basic token colors so fenced code blocks look highlighted
  { tag: [t.keyword, t.modifier, t.operatorKeyword], class: "cm-tok-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "cm-tok-string" },
  { tag: [t.comment, t.blockComment, t.lineComment], class: "cm-tok-comment" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "cm-tok-number" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "cm-tok-fn" },
  { tag: [t.typeName, t.className, t.namespace], class: "cm-tok-type" },
  { tag: [t.propertyName, t.attributeName], class: "cm-tok-prop" },
]);

/* ---------------- wikilink + tag decorations ---------------- */

const WIKILINK_DECO_RE = /\[\[([^\[\]]+?)\]\]/g;

function wikilinkDecorations(app: GeodeApp, getPath: () => string): Extension {
  const matcher = new MatchDecorator({
    regexp: WIKILINK_DECO_RE,
    decoration: (m) => {
      const target = wikilinkTarget(m[1]);
      if (!target) return null;
      const resolved = app.metadata.resolveLink(target, getPath()) !== null;
      return Decoration.mark({
        class: resolved ? "cm-wikilink" : "cm-wikilink cm-wikilink-unresolved",
        attributes: { "data-link-target": target },
      });
    },
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(update: ViewUpdate) {
        const forced = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshWikilinks)),
        );
        this.decorations = forced
          ? matcher.createDeco(update.view)
          : matcher.updateDeco(update, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const tagMark = Decoration.mark({ class: "cm-hashtag" });
const tagMatcher = new MatchDecorator({
  // mirrors core/metadata TAG_RE (incl. CJK)
  regexp: /(^|[\s(])#([A-Za-z0-9_\/\-一-鿿]+)/g,
  decorate: (add, from, to, match) => {
    add(from + match[1].length, to, tagMark);
  },
});

const tagPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tagMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = tagMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/* ---------------- Ctrl+Click navigation ---------------- */

function wikilinkClickHandler(app: GeodeApp, getPath: () => string): Extension {
  return EditorView.domEventHandlers({
    mousedown: (event) => {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
      const el =
        event.target instanceof HTMLElement ? event.target.closest(".cm-wikilink") : null;
      const target = el?.getAttribute("data-link-target");
      if (!target) return false;
      event.preventDefault();
      void openWikilink(app, target, getPath());
      return true;
    },
  });
}

/* ---------------- [[ autocomplete ---------------- */

function wikilinkCompletionSource(app: GeodeApp) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/\[\[[^\[\]]*$/);
    if (!before) return null;
    const files = app.vault.getMarkdownFiles();
    const dupCount = new Map<string, number>();
    for (const f of files) {
      const key = f.basename.toLowerCase();
      dupCount.set(key, (dupCount.get(key) ?? 0) + 1);
    }
    const options: Completion[] = files.map((f) => {
      const folder = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      const ambiguous = (dupCount.get(f.basename.toLowerCase()) ?? 0) > 1;
      const linkText = ambiguous ? f.path.replace(/\.md$/i, "") : f.basename;
      return {
        label: f.basename,
        detail: folder || undefined,
        apply: (view, _completion, from, to) => {
          const closing = view.state.sliceDoc(to, to + 2) === "]]" ? "" : "]]";
          view.dispatch({
            changes: { from, to, insert: linkText + closing },
            selection: { anchor: from + linkText.length + 2 },
          });
        },
      };
    });
    return { from: before.from + 2, options, validFor: /^[^\[\]]*$/ };
  };
}

/* ---------------- the full stack ---------------- */

export function buildEditorExtensions(opts: {
  app: GeodeApp;
  /** live path accessor — file:renamed retargets without a view rebuild */
  getPath: () => string;
  /** "live" = Obsidian-style live preview (default), "source" = raw markdown */
  mode: "live" | "source";
}): Extension[] {
  const { app, getPath, mode } = opts;
  return [
    ...(mode === "live" ? livePreview(app, getPath) : []),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(mdHighlight),
    EditorView.lineWrapping,
    placeholder("Start writing…"),
    editorTheme,
    keymap.of([...defaultKeymap, indentWithTab]),
    autocompletion({ override: [wikilinkCompletionSource(app)], icons: false }),
    wikilinkDecorations(app, getPath),
    tagPlugin,
    wikilinkClickHandler(app, getPath),
  ];
}
