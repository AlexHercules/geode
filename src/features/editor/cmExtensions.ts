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
import { HighlightStyle, LanguageSupport, foldService, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { type Compartment, StateEffect, StateField, type Extension } from "@codemirror/state";
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
// aliased: `t` is taken by @lezer/highlight tags in this file
import { t as tr } from "@core/i18n";
import { attachmentIngest } from "./attachments";
import { markdownFolding } from "./folding";
import { livePreview } from "./livePreview";
import { openWikilink, wikilinkTarget } from "./wikilinks";

/** Dispatched when the metadata index changes so wikilink resolution re-runs. */
export const refreshWikilinks = StateEffect.define<null>();

/* ---------------- reveal flash (R14) ---------------- */

/**
 * One-shot reveal highlight: EditorPane dispatches `revealFlash` with the
 * target position after scrolling there (workspace.revealTarget consumption);
 * the line gets `.cm-reveal-flash` (CSS fade-out animation) and EditorPane
 * dispatches `clearRevealFlash` ~1200ms later to drop the decoration.
 */
export const revealFlash = StateEffect.define<{ from: number }>({
  map: (value, mapping) => ({ from: mapping.mapPos(value.from) }),
});

export const clearRevealFlash = StateEffect.define<null>();

const revealFlashLine = Decoration.line({ class: "cm-reveal-flash" });

const revealFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(revealFlash)) {
        const pos = Math.min(Math.max(0, effect.value.from), tr.state.doc.length);
        deco = Decoration.set([revealFlashLine.range(tr.state.doc.lineAt(pos).from)]);
      } else if (effect.is(clearRevealFlash)) {
        deco = Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

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
      // raw text between '#' and '|' — Ctrl+Click reveal (R14) needs it too
      const rawBody = m[1].split("|")[0];
      const hashIdx = rawBody.indexOf("#");
      const subpath = hashIdx >= 0 ? rawBody.slice(hashIdx + 1) : "";
      if (!target) {
        // R16: [[#h]] self-link — always styled resolved (the note itself
        // exists; subpath validity is checked on click, like Obsidian).
        // Subpath-less empty targets stay undecorated.
        if (!subpath) return null;
        return Decoration.mark({
          class: "cm-wikilink",
          attributes: { "data-link-target": "", "data-link-subpath": subpath },
        });
      }
      const resolved = app.metadata.resolveLink(target, getPath()) !== null;
      return Decoration.mark({
        class: resolved ? "cm-wikilink" : "cm-wikilink cm-wikilink-unresolved",
        attributes: subpath
          ? { "data-link-target": target, "data-link-subpath": subpath }
          : { "data-link-target": target },
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
      if (target === null || target === undefined) return false;
      const subpath = el?.getAttribute("data-link-subpath");
      // R16: an empty target is a [[#h]] self-link — only navigable when the
      // subpath attribute rides along (defensive against stray marks)
      if (target === "" && !subpath) return false;
      event.preventDefault();
      void openWikilink(app, target, getPath(), subpath ?? undefined);
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

/**
 * The mode-dependent slice of the editor stack (R11): live preview decorations
 * for "live", nothing for "source". Lives in a Compartment so EditorPane can
 * swap live↔source via reconfigure WITHOUT rebuilding the view (selection,
 * scroll and undo history survive untouched).
 */
export function editorModeExtensions(
  app: GeodeApp,
  getPath: () => string,
  mode: "live" | "source",
): Extension {
  return mode === "live" ? livePreview(app, getPath) : [];
}

/**
 * R17 (review fix): lang-markdown's markdown() bundles its own `headerIndent`
 * foldService whose Setext/ATX section folding bypasses the frozen R17 fold
 * semantics — e.g. the pseudo-heading an unclosed/comment-bearing frontmatter
 * produces would fold the whole body. Strip exactly that entry (the only
 * support member providing the foldService facet); the markdown keymap,
 * paste-URL-as-link and HTML completion support all stay.
 */
function markdownSansHeaderFold(): Extension {
  const md = markdown({ base: markdownLanguage, codeLanguages: languages });
  const support = Array.isArray(md.support)
    ? (md.support as Extension[]).filter(
        (ext) => (ext as { facet?: unknown }).facet !== foldService,
      )
    : md.support;
  return new LanguageSupport(md.language, support);
}

export function buildEditorExtensions(opts: {
  app: GeodeApp;
  /** live path accessor — file:renamed retargets without a view rebuild */
  getPath: () => string;
  /** "live" = Obsidian-style live preview (default), "source" = raw markdown */
  mode: "live" | "source";
  /** owned by EditorPane — live↔source reconfigures this slice in place */
  modeCompartment: Compartment;
}): Extension[] {
  const { app, getPath, mode, modeCompartment } = opts;
  return [
    modeCompartment.of(editorModeExtensions(app, getPath, mode)),
    revealFlashField,
    markdownSansHeaderFold(),
    syntaxHighlighting(mdHighlight),
    EditorView.lineWrapping,
    // resolved at view build time — a locale switch applies to views built after it
    placeholder(tr("editor.placeholder")),
    editorTheme,
    keymap.of([...defaultKeymap, indentWithTab]),
    autocompletion({ override: [wikilinkCompletionSource(app)], icons: false }),
    wikilinkDecorations(app, getPath),
    tagPlugin,
    wikilinkClickHandler(app, getPath),
    // R17 — base list, NOT the mode compartment: fold state lives in the
    // EditorState and must survive live<->source reconfigures
    attachmentIngest(app, getPath),
    markdownFolding(),
  ];
}
