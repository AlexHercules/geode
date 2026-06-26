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
  closeBrackets,
  closeBracketsKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { vim } from "@replit/codemirror-vim";
import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { HighlightStyle, LanguageSupport, foldService, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import {
  type Compartment,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
  MatchDecorator,
  placeholder,
  rectangularSelection,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { GeodeApp } from "@app/AppContext";
import type { FileNode, HeadingRef } from "@core/types";
import { MARKDOWN_WRAP_CHARS, markdownWrapInput } from "@core/bracketWrap";
// aliased: `t` is taken by @lezer/highlight tags in this file
import { t as tr } from "@core/i18n";
import { autoPairBrackets, autoPairMarkdown, foldHeading, hideReferenceMarks, indentUsingTabs, showLineNumbers, smartLists, tabIndentSize, vimMode } from "@core/appearance";
import { getEditorExtensions } from "@core/editorExtensions";
import { linkPathFormat } from "@core/linkFormat";
import { attachmentIngest } from "./attachments";
import { markdownFolding, markdownFoldService } from "./folding";
import { foldPersistence } from "./foldPersistence";
import { livePreview, propertiesHostFacet } from "./livePreview";
import { editorSearchPhrases } from "./searchCommands";
import { slashCommandSource } from "./slashCommands";
import { tagCompletionSource } from "./tagCompletion";
import { openWikilink, wikilinkTarget } from "./wikilinks";

/** Dispatched when the metadata index changes so wikilink resolution re-runs. */
export const refreshWikilinks = StateEffect.define<null>();

/* ---------------- properties panel host (R22) ---------------- */

/**
 * `refreshProperties` — dispatched by EditorPane when
 * workspace.propertiesInDocument changes so the livePreview frontmatter field
 * recomputes its decoration mode.
 * `propertiesHostFacet` — stable per-pane container element hosting the React
 * PropertiesPanel portal. Provided by buildEditorExtensions; consumed by the
 * livePreview PropertiesHostWidget. null = no host (degraded pill behaviour).
 * Both are DEFINED in livePreview.ts (next to the consuming StateField) and
 * re-exported here — the public import surface is unchanged.
 */
export { propertiesHostFacet, refreshProperties } from "./livePreview";

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
    // R50: readable line length — "none" (toggle off) → full-width editor body
    maxWidth: "var(--readable-line-width, 46em)",
    margin: "0 auto",
    /* --caret-color: Obsidian theme knob (R20 bridge defaults it to the
       interactive accent — identical to the old hard-coded accent) */
    caretColor: "var(--caret-color, var(--accent))",
  },
  ".cm-line": { padding: "0 32px" },
  // R88: theme-aware line-number gutter — CM's base theme (the editor never
  // declares a dark facet) would otherwise paint #6c6c6c numbers + a light-blue
  // active-line gutter block, clashing with Geode's dark theme.
  ".cm-lineNumbers .cm-gutterElement": { color: "var(--text-faint)" },
  ".cm-activeLineGutter": { background: "transparent", color: "var(--text-muted)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--caret-color, var(--accent))" },
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
  /* ---- search/replace panel (R34) — themed to match Geode, CSS vars only ---- */
  ".cm-panels": {
    background: "var(--bg-panel)",
    color: "var(--text-normal)",
    borderColor: "var(--border)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  // scale with the editor font-size setting (no hardcoded px — R34 review fix)
  ".cm-panel.cm-search": { padding: "8px 10px", fontFamily: "inherit", fontSize: "var(--editor-font-size)" },
  ".cm-panel.cm-search label": { fontSize: "calc(var(--editor-font-size) * 0.85)", color: "var(--text-muted)" },
  ".cm-panel.cm-search .cm-textfield": {
    background: "var(--bg-input, var(--bg-modal))",
    color: "var(--text-normal)",
    border: "1px solid var(--border-strong)",
    borderRadius: "5px",
    padding: "3px 7px",
    fontFamily: "inherit",
  },
  ".cm-panel.cm-search .cm-textfield:focus": {
    outline: "none",
    borderColor: "var(--accent)",
  },
  ".cm-panel.cm-search .cm-button": {
    background: "var(--bg-modal)",
    color: "var(--text-normal)",
    border: "1px solid var(--border-strong)",
    borderRadius: "5px",
    backgroundImage: "none",
    padding: "3px 9px",
    cursor: "pointer",
  },
  ".cm-panel.cm-search .cm-button:hover": { background: "var(--accent-muted)" },
  ".cm-panel.cm-search button[name='close']": {
    color: "var(--text-muted)",
    cursor: "pointer",
  },
  ".cm-searchMatch": {
    background: "var(--accent-muted)",
    outline: "1px solid var(--border-strong)",
  },
  ".cm-searchMatch-selected": { background: "var(--accent)", color: "var(--text-on-accent)" },
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

/** R109 (㊹ 续): a one-line preview of a block (the paragraph the `^id` marker is on), for
 *  the `[[note#^` completion — strip the trailing `^id` marker, collapse whitespace, truncate.
 *  Geode mints opaque block ids, so the preview (not the id) is how you pick the block. */
function blockPreview(content: string, from: number, to: number): string {
  const raw = content.slice(from, to).replace(/\s*\^[A-Za-z0-9-]+\s*$/, "").replace(/\s+/g, " ").trim();
  return raw.length > 80 ? raw.slice(0, 79) + "…" : raw;
}

/** R109 (㊹ 续): the block references a `[[<note>#^<query>` completion offers — resolve the
 *  note, read its text (async — `BlockRef` carries only the span), return each block's id +
 *  a one-line text preview (skipping ids that would break the `[[…#^…]]` structure). Returns
 *  null when there is no `#^`, the note can't be resolved, or it has no blocks. Exported for
 *  the probe. */
export async function wikilinkBlockTargets(
  app: GeodeApp,
  typed: string,
  fromPath: string | null,
): Promise<Array<{ id: string; text: string }> | null> {
  const hashIdx = typed.indexOf("#");
  if (hashIdx < 0 || typed[hashIdx + 1] !== "^") return null;
  const noteRef = typed.slice(0, hashIdx);
  const target = noteRef === "" ? fromPath : app.metadata.resolveLink(noteRef, fromPath ?? "");
  if (target === null) return null;
  const blocks = (app.metadata.getMetadata(target)?.blocks ?? []).filter((b) => !/[[\]|#]/.test(b.id));
  if (blocks.length === 0) return null;
  let content: string;
  try {
    content = await app.vault.read(target);
  } catch {
    return null;
  }
  return blocks.map((b) => ({ id: b.id, text: blockPreview(content, b.from, b.to) }));
}

/** R107 (㊹ 续): the headings a `[[<note>#<query>` completion offers — resolve `<note>`
 *  (empty = the current file, a `[[#h]]` self-link), list its headings, and skip any whose
 *  text would break the `[[…#…]]` structure (`[ ] | #`). Returns null when there is no `#`
 *  yet or the note can't be resolved. Exported for the probe. */
export function wikilinkHeadingTargets(app: GeodeApp, typed: string, fromPath: string | null): HeadingRef[] | null {
  const hashIdx = typed.indexOf("#");
  if (hashIdx < 0) return null;
  const noteRef = typed.slice(0, hashIdx);
  const target = noteRef === "" ? fromPath : app.metadata.resolveLink(noteRef, fromPath ?? "");
  if (target === null) return null;
  return (app.metadata.getMetadata(target)?.headings ?? []).filter((h) => h.text !== "" && !/[[\]|#]/.test(h.text));
}

/** R108 (㊹ 续续): the non-md attachments a `[[` completion offers — picking one inserts
 *  `[[image.png]]` (a link) / `![[image.png]]` (an embed if the user typed `![[`), resolved
 *  by `resolveAttachment` (keyed on the name WITH extension). Link text = the name unless it
 *  is ambiguous (a same-named attachment elsewhere) or `absolute` path format, then the full
 *  path; names that would break the `[[…]]` structure (`[ ] | #`) are dropped. Pure; exported
 *  for the probe. Extensionless files are excluded (they are editable, not attachments). */
export function wikilinkAttachmentCandidates(
  files: readonly FileNode[],
  absolute: boolean,
): Array<{ file: FileNode; linkText: string }> {
  const attachments = files.filter((f) => f.extension !== "md" && f.extension !== "");
  const dup = new Map<string, number>();
  for (const f of attachments) dup.set(f.name.toLowerCase(), (dup.get(f.name.toLowerCase()) ?? 0) + 1);
  const out: Array<{ file: FileNode; linkText: string }> = [];
  for (const f of attachments) {
    const linkText = absolute || (dup.get(f.name.toLowerCase()) ?? 0) > 1 ? f.path : f.name;
    if (/[[\]|#]/.test(linkText)) continue;
    out.push({ file: f, linkText });
  }
  return out;
}

function wikilinkCompletionSource(app: GeodeApp, getPath: () => string) {
  return (ctx: CompletionContext): CompletionResult | Promise<CompletionResult | null> | null => {
    const before = ctx.matchBefore(/\[\[[^\[\]]*$/);
    if (!before) return null;
    // shared apply: replace [from,to] with `text` + a closing `]]` (unless one is there)
    const applyLink = (text: string) => (view: EditorView, _c: Completion, from: number, to: number) => {
      const closing = view.state.sliceDoc(to, to + 2) === "]]" ? "" : "]]";
      view.dispatch({
        changes: { from, to, insert: text + closing },
        selection: { anchor: from + text.length + 2 },
      });
    };
    // R107 (㊹ 续): `[[<note>#<query>` → complete that note's headings (insert
    // `[[note#Heading]]`). Replaces only the text after `#`; `[[#…` targets the current file.
    const typed = before.text.slice(2);
    const hashIdx = typed.indexOf("#");
    if (hashIdx >= 0) {
      // R107 review: use THIS editor's path (getPath, always non-null) not the global
      // getActiveFile() — they diverge when focus enters a non-active pane, which would
      // resolve `[[#`/ambiguous `[[note#` against the wrong file.
      if (typed[hashIdx + 1] === "^") {
        // R109 (㊹ 续): `[[note#^` → block-reference completion. Async — the preview text needs
        // the note's content. The displayed LABEL is the block text (you pick by content); the
        // inserted text is the opaque block id, so apply replaces the typed filter after `#^`.
        return wikilinkBlockTargets(app, typed, getPath()).then((blocks) => {
          if (blocks === null || blocks.length === 0) return null;
          return {
            from: before.from + 2 + hashIdx + 2,
            options: blocks.map((b) => ({ label: b.text || b.id, detail: `^${b.id}`, apply: applyLink(b.id) })),
            validFor: /^[^\[\]#]*$/,
          };
        });
      }
      const headings = wikilinkHeadingTargets(app, typed, getPath());
      if (headings === null || headings.length === 0) return null;
      return {
        from: before.from + 2 + hashIdx + 1,
        options: headings.map((h) => ({ label: h.text, detail: `H${h.level}`, apply: applyLink(h.text) })),
        validFor: /^[^\[\]#]*$/,
      };
    }
    const files = app.vault.getMarkdownFiles();
    const dupCount = new Map<string, number>();
    for (const f of files) {
      const key = f.basename.toLowerCase();
      dupCount.set(key, (dupCount.get(key) ?? 0) + 1);
    }
    // R72 (㉞-c): the user typed `[[` so the link type is wikilink; only the path
    // format applies. "absolute" → always the vault-root path; "shortest"/
    // "relative" (relative degrades for wikilinks) → basename unless ambiguous.
    const absolute = linkPathFormat.get() === "absolute";
    // canonical wikilink text for a note (path-format aware: absolute / ambiguous → path)
    const canonicalLink = (f: { path: string; basename: string }) =>
      absolute || (dupCount.get(f.basename.toLowerCase()) ?? 0) > 1
        ? f.path.replace(/\.md$/i, "")
        : f.basename;
    const options: Completion[] = files.map((f) => ({
      label: f.basename,
      detail: (f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "") || undefined,
      apply: applyLink(canonicalLink(f)),
    }));
    // R106 (㉟ 续): surface frontmatter aliases — picking one inserts `[[canonical|alias]]`
    // (resolves to the note via the canonical name, displays the alias). Obsidian behaviour.
    const aliasMap = app.metadata.getAliasMap();
    for (const f of files) {
      const aliases = aliasMap.get(f.path);
      if (!aliases) continue;
      const canonical = canonicalLink(f);
      for (const alias of aliases) {
        // a `[` / `]` in the display text would break the `[[…]]` structure → skip it in the
        // inserter (the alias still resolves + shows in QuickSwitcher, just isn't offered here)
        if (alias.includes("[") || alias.includes("]")) continue;
        options.push({
          label: alias,
          detail: `↪ ${f.basename}`,
          apply: applyLink(`${canonical}|${alias}`),
        });
      }
    }
    // R108 (㊹ 续续): also offer non-md attachments (images/pdf/…) so `[[image.png]]` links
    // and `![[image.png]]` embeds. The label keeps the extension (it's how attachments resolve).
    for (const { file, linkText } of wikilinkAttachmentCandidates(app.vault.getFiles(), absolute)) {
      const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
      options.push({ label: file.name, detail: folder || undefined, apply: applyLink(linkText) });
    }
    return { from: before.from + 2, options, validFor: /^[^\[\]]*$/ };
  };
}

/* ---------------- markdown emphasis selection-wrap (R35) ---------------- */

/**
 * Typing a markdown emphasis marker (`* _ ` ~ = $`) over a NON-EMPTY selection
 * wraps it (additive — the inner text stays selected so a 2nd keystroke re-wraps:
 * `*sel*` → `**sel**`). Brackets/quotes `( [ { " '` are handled by closeBrackets();
 * this only covers the markdown chars closeBrackets ignores. Empty selection or a
 * non-marker char → return false → CM inserts normally (so line-start `* ` bullets,
 * ``` fences are untouched; CJK input is safe since its committed text is never one
 * of these ASCII chars). The cheap pre-guard avoids slicing the whole doc on the
 * keystroke hot path. Pure decision lives in core/bracketWrap.ts (probe-shared).
 */
const markdownWrapHandler = Prec.high(
  EditorView.inputHandler.of((view, from, to, text) => {
    if (to <= from || text.length !== 1 || !MARKDOWN_WRAP_CHARS.has(text)) return false;
    const edit = markdownWrapInput(view.state.sliceDoc(), from, to, text);
    if (!edit) return false;
    view.dispatch({
      changes: edit.changes,
      selection: { anchor: edit.selection.anchor, head: edit.selection.head },
      userEvent: "input.type",
      scrollIntoView: true,
    });
    return true;
  }),
);

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
  hideMarks = true,
): Extension {
  return mode === "live" ? livePreview(app, getPath, hideMarks) : [];
}

/**
 * R92 (㊶ 续续): the string inserted for ONE indent level — a tab char when
 * "Indent using tabs" is on, otherwise `size` spaces. Single source of truth for
 * the CM `indentUnit` facet (drives Tab / indentWithTab) and the probe.
 */
export function indentUnitString(size: number, useTabs: boolean): string {
  return useTabs ? "\t" : " ".repeat(size);
}

/**
 * R92: the indentation slice (tab visual width + indent unit). Lives in a
 * Compartment so EditorPane can reconfigure it on a settings change WITHOUT
 * rebuilding the view — mirrors R88's lineNumberCompartment. tabSize sets how
 * wide a literal `\t` renders; indentUnit is what Tab inserts.
 */
export function indentExtensions(size: number, useTabs: boolean): Extension {
  return [EditorState.tabSize.of(size), indentUnit.of(indentUnitString(size, useTabs))];
}

/**
 * R153 (㊶): the auto-pair-brackets slice (Obsidian's "Auto pair brackets"). Lives in a
 * Compartment so EditorPane can toggle it without rebuilding the view — mirrors R88/R92.
 * `on` → CM's closeBrackets() (auto-close `( [ { " '`) + its keymap (Backspace-delete-pair);
 * `off` → nothing. The keymap must precede defaultKeymap so the pair-delete wins (see base list).
 */
export function closeBracketsExtension(on: boolean): Extension {
  return on ? [keymap.of(closeBracketsKeymap), closeBrackets()] : [];
}

/**
 * R225: Obsidian's "Auto pair Markdown syntax" toggle. `on` → the R35 markdownWrapHandler
 * (selection-wrap with `* _ ~ = $ \``); `off` → nothing. Owned by a Compartment so EditorPane
 * can flip it without rebuilding the view (mirrors closeBracketsExtension / autoPairBrackets).
 */
export function markdownWrapExtension(on: boolean): Extension {
  return on ? markdownWrapHandler : [];
}

/**
 * R232: Obsidian's "Smart lists" toggle. `on` → lang-markdown's markdownKeymap
 * (Enter = insertNewlineContinueMarkup: continue/renumber/outdent list markup +
 * the bundled blockquote continuation; Backspace = deleteMarkupBackward: dedent);
 * `off` → nothing (Enter/Backspace fall through to defaultKeymap). Prec.high preserves
 * the precedence the keymap had inside markdown()'s support (wins over closeBrackets +
 * defaultKeymap). Owned by a Compartment so EditorPane can flip it without rebuilding
 * the view (mirrors markdownWrapExtension / closeBracketsExtension).
 */
export function smartListExtension(on: boolean): Extension {
  return on ? Prec.high(keymap.of(markdownKeymap)) : [];
}

/**
 * R253: Obsidian's Editor "Vim key bindings" — `on` installs @replit/codemirror-vim's `vim()`
 * (normal/insert/visual modes, ex commands); `off` → nothing (plain editing). Owned by a
 * Compartment so EditorPane can flip it without rebuilding the view (mirrors smartLists). vim()
 * self-manages its keymap precedence (above defaultKeymap); it sits BELOW the R33 Prec.highest
 * command interception so Geode hotkeys (Cmd+P …) still win over vim's normal-mode keys. Vim's
 * edits go through the standard CM dispatch, so docChanged → autosave fires unchanged (底线①).
 * Wrapped in Prec.high so vim's keymap outranks `defaultKeymap` — otherwise defaultKeymap's
 * `Escape → simplifySelection` (R63 multi-cursor) shadows vim's insert→normal Escape, trapping the
 * user in insert mode. (Still below the R33 Prec.highest command interceptor.)
 */
export function vimExtension(on: boolean): Extension {
  return on ? Prec.high(vim()) : [];
}

/**
 * R17 (review fix): lang-markdown's markdown() bundles its own `headerIndent`
 * foldService whose Setext/ATX section folding bypasses the frozen R17 fold
 * semantics — e.g. the pseudo-heading an unclosed/comment-bearing frontmatter
 * produces would fold the whole body. Strip exactly that entry (the only
 * support member providing the foldService facet); paste-URL-as-link and HTML
 * completion support stay. R232: addKeymap:false drops the bundled markdownKeymap
 * here — it now lives in smartListCompartment (Smart lists toggle), re-added at the
 * same Prec.high so precedence vs closeBrackets/defaultKeymap is unchanged.
 */
function markdownSansHeaderFold(): Extension {
  const md = markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false });
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
  /** R88: owned by EditorPane — showLineNumbers toggle reconfigures it in place */
  lineNumberCompartment: Compartment;
  /** R92: owned by EditorPane — tabIndentSize / indentUsingTabs reconfigure it in place */
  indentCompartment: Compartment;
  /** R153: owned by EditorPane — autoPairBrackets toggle reconfigures it in place */
  closeBracketsCompartment: Compartment;
  /** R225: owned by EditorPane — autoPairMarkdown toggle reconfigures it in place */
  markdownWrapCompartment: Compartment;
  /** R232: owned by EditorPane — smartLists toggle reconfigures it in place */
  smartListCompartment: Compartment;
  /** R253: owned by EditorPane — vimMode toggle reconfigures it in place */
  vimCompartment: Compartment;
  /** R156: owned by EditorPane — the foldHeading toggle reconfigures it in place */
  foldServiceCompartment: Compartment;
  /** R115: owned by EditorPane — plugin-contributed CM6 extensions
   *  (Plugin.registerEditorExtension); editorExtensionsRevision reconfigures it */
  compatExtensionCompartment: Compartment;
  /** stable container for the React PropertiesPanel portal (R22) */
  propertiesHost?: HTMLElement;
}): Extension[] {
  const { app, getPath, mode, modeCompartment, lineNumberCompartment, indentCompartment, closeBracketsCompartment, markdownWrapCompartment, smartListCompartment, vimCompartment, foldServiceCompartment, compatExtensionCompartment } =
    opts;
  return [
    // R33 — route command hotkeys through the app command layer (R32) while the
    // editor is focused, at the HIGHEST precedence so it runs BEFORE CM's own
    // keymaps and the browser's native contenteditable shortcuts. Without this,
    // a native Cmd+I expands the selection to the whole line before the
    // window-level listener reads it (bold-on-selection worked, but italic
    // italicised the whole line). handleKeydown preventDefault + stopPropagation
    // when it owns the key, so the window listener never double-fires; when it
    // returns false CM proceeds normally (typing, Cmd+A select-all, etc.).
    Prec.highest(
      EditorView.domEventHandlers({
        keydown: (e) => app.commands.handleKeydown(e),
      }),
    ),
    // R253: Vim key bindings — empty when off; EditorPane reconfigures on the vimMode toggle. Placed
    // right below the R33 command interception so Geode hotkeys still win, but above the rest so vim's
    // normal-mode keys intercept letters. In the BASE list (not modeCompartment) → survives live↔source.
    vimCompartment.of(vimExtension(vimMode.get())),
    propertiesHostFacet.of(opts.propertiesHost ?? null),
    modeCompartment.of(editorModeExtensions(app, getPath, mode, hideReferenceMarks.get())),
    // R88: line-number gutter — empty when off; EditorPane reconfigures on toggle
    lineNumberCompartment.of(showLineNumbers.get() ? [lineNumbers()] : []),
    // R92: indentation (tab width + indent unit) — EditorPane reconfigures on setting change
    indentCompartment.of(indentExtensions(tabIndentSize.get(), indentUsingTabs.get())),
    // R115: plugin-contributed CM6 extensions (Plugin.registerEditorExtension) — empty when
    // none registered; EditorPane reconfigures on editorExtensionsRevision. (Array position is
    // not what guards the base: the command keymap is Prec.highest (R33) and autosave is an
    // order-independent updateListener, so a plugin extension can't outrank either by placement.)
    compatExtensionCompartment.of(getEditorExtensions()),
    revealFlashField,
    markdownSansHeaderFold(),
    // R232: the markdownKeymap (list/quote continuation + dedent), gated by Obsidian's
    // "Smart lists" toggle. Re-added here at the position+Prec.high it had inside markdown()'s
    // support (addKeymap:false above), so OFF→plain Enter/Backspace, ON→byte-identical to pre-R232.
    smartListCompartment.of(smartListExtension(smartLists.get())),
    syntaxHighlighting(mdHighlight),
    // R52 — markdown defines no comment tokens, so give the `editor:toggle-comment`
    // command (and CM's comment commands) Obsidian's `%%…%%` block comment. With no
    // line-comment token toggleComment falls through to the block path and wraps /
    // unwraps the selection (or current line) in `%%`.
    markdownLanguage.data.of({ commentTokens: { block: { open: "%%", close: "%%" } } }),
    EditorView.lineWrapping,
    // resolved at view build time — a locale switch applies to views built after it
    placeholder(tr("editor.placeholder")),
    editorTheme,
    // R63 (㉕) — multiple cursors / selections. Native CM6; the real gap was that
    // Geode could not render >1 cursor AT ALL. This 2-line foundation fixes that:
    // allowMultipleSelections lets state hold >1 range, drawSelection renders every
    // cursor/selection (the native browser caret only shows one). It also unlocks
    // defaultKeymap bindings that were silent no-ops: Mod-Alt-↑/↓ addCursorAbove/
    // Below and Escape simplifySelection (keyboard-first, per Geode's stated
    // principle; Obsidian core multi-cursor is mouse-based). NOTE Mod-d is owned by
    // the daily-note command (interceptor), and select-next is an Obsidian COMMUNITY
    // plugin not core, so selectNextOccurrence stays shadowed — by design.
    // rectangularSelection + crosshairCursor add Alt-drag column/rectangular select.
    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    rectangularSelection(),
    crosshairCursor(),
    // R35 — Backspace over an empty auto-pair (e.g. `(|)`) deletes BOTH brackets.
    // Above defaultKeymap so the pair-delete wins over the plain backspace.
    // R153: closeBrackets() + its keymap live in this compartment (autoPairBrackets toggle).
    closeBracketsCompartment.of(closeBracketsExtension(autoPairBrackets.get())),
    keymap.of([...defaultKeymap, indentWithTab]),
    // R34 — in-editor find/replace. The panel UI + state; searchKeymap provides
    // in-panel keys (Enter=next, Shift-Enter=prev, Escape=close, F3, Mod-d). The
    // OPEN commands (Mod+F editor:search) go through the app command layer
    // (registerSearchCommands) so they reach the palette + are rebindable, and
    // the R33 Prec.highest interceptor handles them before this keymap (its own
    // Mod-f is harmlessly shadowed). Phrases localized via EditorState.phrases
    // (build-time, like the placeholder — R8 locale-switch caveat applies).
    search({ top: true }),
    keymap.of(searchKeymap),
    EditorState.phrases.of(editorSearchPhrases()),
    // R35 — auto-pair brackets/quotes (`( [ { " '`): auto-close, selection-wrap, type-over.
    // R153: closeBrackets() itself moved UP into closeBracketsCompartment (autoPairBrackets toggle).
    // R225: markdownWrapHandler (Prec.high, disjoint emphasis chars `* _ ` ~ = $` for selection-wrap)
    // now lives in markdownWrapCompartment, gated by Obsidian's "Auto pair Markdown syntax" toggle.
    // `[` pairing coordinates with the wikilink `]]` completion via that source's
    // `sliceDoc(to,to+2)==="]]"` guard (no double `]]`).
    markdownWrapCompartment.of(markdownWrapExtension(autoPairMarkdown.get())),
    autocompletion({
      override: [wikilinkCompletionSource(app, getPath), slashCommandSource(app), tagCompletionSource(app)],
      icons: false,
    }),
    wikilinkDecorations(app, getPath),
    tagPlugin,
    wikilinkClickHandler(app, getPath),
    // R17 — base list, NOT the mode compartment: fold state lives in the
    // EditorState and must survive live<->source reconfigures
    attachmentIngest(app, getPath),
    markdownFolding(),
    // R156: the foldService (gated by Fold heading / Fold indent settings) — base list like
    // markdownFolding so it survives live↔source; EditorPane reconfigures it on toggle.
    foldServiceCompartment.of(markdownFoldService(foldHeading.get())),
    // R29 — capture fold state to localStorage (base list like markdownFolding:
    // must survive live<->source reconfigures); restore happens in EditorPane
    foldPersistence(getPath),
  ];
}
