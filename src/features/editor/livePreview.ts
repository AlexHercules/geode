/**
 * livePreview.ts — Obsidian-style live preview for the Geode editor.
 *
 * A ViewPlugin walks the markdown syntax tree over the visible ranges and
 * hides formatting characters (heading hashes, emphasis stars, link brackets,
 * quote marks, …) unless the selection touches the construct, in which case
 * the raw syntax is revealed for editing. Some marks are replaced with
 * interactive widgets (task checkboxes, bullets, horizontal rules).
 *
 * The frontmatter block decoration spans line breaks, which CM6 forbids from
 * view plugins — it lives in a StateField (buildFrontmatterField). R22: when a
 * properties host container rides in via propertiesHostFacet, the block is
 * replaced by PropertiesHostWidget (the React PropertiesPanel portal target)
 * per the workspace propertiesInDocument preference; without a host the R21
 * "Properties" pill behaviour remains as the degraded path.
 *
 * R11: `![[img]]` embeds that resolve to a vault image are replaced with an
 * <img> widget (EmbedWidget); cursor contact reveals the raw text as usual.
 *
 * R12: `![[note]]` embeds that miss the image path but resolve to a markdown
 * note are replaced with a NoteEmbedWidget — a reading-view-isomorphic
 * placeholder hydrated by the shared core engine. Image check runs FIRST;
 * unresolved targets stay raw text. Display only: never writes the document.
 *
 * R13: trailing block id markers (" ^id") are hidden — leading space included
 * — unless the selection touches the line, mirroring the reading-view strip.
 *
 * R14: the wikilink/embed regex scan skips fenced-code lines (R13 debt) and
 * collapsed wikilink marks carry data-link-subpath so clicks on
 * [[note#Heading]] / [[note#^id]] reveal the target span in the opened note.
 *
 * R18: markdown dialect long tail — callout line decorations (frozen title
 * regex), ==highlight== marks, same-line %%comment%% hiding + cross-line
 * comment-block line tinting, [^id] footnote-ref marks, and KaTeX math
 * widgets for $inline$ / single-line $$display$$ (cross-line $$ blocks get
 * line tinting only — view plugins may not build cross-line replaces).
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Facet, Prec, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { hydrateEmbeds as coreHydrateEmbeds } from "@core/embeds";
import { t } from "@core/i18n";
import { IMAGE_EXTS, fileEmbedKind, parseEmbedSize } from "@core/markdown";
import { loadKatex } from "@core/math";
import { parseFrontmatter } from "@core/metadata";
import { getEmbedUrl } from "./embeds";
import { liveMath } from "./liveMath";
import { liveMermaid } from "./liveMermaid";
import { liveTables } from "./liveTables";
import { openWikilink, wikilinkTarget } from "./wikilinks";

/* ================= properties panel host plumbing (R22) ================= */
// Defined here (the consuming StateField lives in this file) and RE-EXPORTED
// from cmExtensions.ts so the public import surface is unchanged.

/** Dispatched by EditorPane when workspace.propertiesInDocument changes so the
 *  livePreview frontmatter field recomputes its decoration mode. */
export const refreshProperties = StateEffect.define<null>();

/** Stable per-pane container element hosting the React PropertiesPanel portal
 *  (R22). Provided by buildEditorExtensions; consumed by the livePreview
 *  PropertiesHostWidget. null = no host (degraded pill behaviour). */
export const propertiesHostFacet = Facet.define<HTMLElement | null, HTMLElement | null>({
  combine: (values) => values.find((v) => v != null) ?? null,
});

/* ================= helpers ================= */

/** True when any selection range overlaps [from, to] (inclusive edges). */
function selectionTouches(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

/** True when any selection range touches the line containing `pos`. */
function lineTouched(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return selectionTouches(state, line.from, line.to);
}

/** Character span of a leading YAML frontmatter block, or 0 when absent. */
function frontmatterEnd(state: EditorState): number {
  const doc = state.doc;
  if (doc.length < 4 || doc.sliceString(0, 3) !== "---") return 0;
  const fm = parseFrontmatter(doc.sliceString(0, Math.min(doc.length, 20_000)));
  return fm ? Math.min(fm.to, doc.length) : 0;
}

/**
 * Offsets of `%%` inside the non-code (even) segments of a backtick-split line.
 * Mirrors core/markdown.ts commentDelimOffsets so the live `%%` scan agrees
 * with the reading pipeline: a `%%` inside an inline-code span (`` `a %% b` ``)
 * never strips and never toggles a cross-line comment block (LP-3). A local
 * reimplementation — the core helper is private and must not be imported.
 */
function commentDelimOffsets(line: string): number[] {
  const offsets: number[] = [];
  let base = 0;
  const segs = line.split(/(`+[^`]*`+)/g);
  for (let i = 0; i < segs.length; i++) {
    if (i % 2 === 0) {
      let at = segs[i].indexOf("%%");
      while (at >= 0) {
        offsets.push(base + at);
        at = segs[i].indexOf("%%", at + 2);
      }
    }
    base += segs[i].length;
  }
  return offsets;
}

/** True when src[pos] is preceded by an odd number of backslashes (escaped).
 *  Mirrors core/markdown.ts isEscapedAt (private — reimplemented locally). */
function isEscapedAt(src: string, pos: number): boolean {
  let backslashes = 0;
  for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === 0x5c /* \ */; i--) backslashes++;
  return backslashes % 2 === 1;
}

function isWsCode(ch: number): boolean {
  return ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d;
}

/**
 * Scan a text slice for inline `$...$` math, mirroring the core/markdown.ts
 * inline rule byte-for-byte (CONTRACT-04): a SINGLE `$` pair (`$$` never
 * participates), opener hugs non-whitespace, closer hugs non-whitespace and is
 * not followed by a digit (currency guard), no newlines inside, and BOTH the
 * opening and closing `$` honour backslash-parity escaping (so `$a\$b$` is one
 * span with tex `a\$b`, not split at the escaped `$`). Offsets are relative to
 * the passed slice. Returns matches in document order, non-overlapping.
 */
function scanInlineMath(src: string): { from: number; to: number; tex: string }[] {
  const out: { from: number; to: number; tex: string }[] = [];
  const max = src.length;
  let start = 0;
  while (start < max) {
    if (src.charCodeAt(start) !== 0x24 /* $ */) {
      start++;
      continue;
    }
    if (isEscapedAt(src, start)) {
      start++;
      continue; // `\$` is not an opener
    }
    if (start + 1 >= max) break;
    if (src.charCodeAt(start + 1) === 0x24) {
      start += 2;
      continue; // `$$` is inert for inline pairing
    }
    if (start > 0 && src.charCodeAt(start - 1) === 0x24 && !isEscapedAt(src, start - 1)) {
      start++;
      continue; // second half of a `$$` run never opens
    }
    if (isWsCode(src.charCodeAt(start + 1))) {
      start++;
      continue; // opener must hug content
    }
    let pos = start + 1;
    let close = -1;
    while (pos < max) {
      const ch = src.charCodeAt(pos);
      if (ch === 0x0a /* \n */) break; // no newlines inside
      if (ch !== 0x24 || isEscapedAt(src, pos)) {
        pos++;
        continue; // not a `$`, or an escaped `\$` — keep scanning
      }
      let runEnd = pos + 1;
      while (runEnd < max && src.charCodeAt(runEnd) === 0x24) runEnd++;
      if (runEnd - pos > 1) {
        pos = runEnd;
        continue; // a `$$` run never closes
      }
      const prev = src.charCodeAt(pos - 1);
      if (isWsCode(prev) || (prev === 0x24 && !isEscapedAt(src, pos - 1))) {
        pos++;
        continue; // closer must hug content / not trail a `$$`
      }
      const next = runEnd < max ? src.charCodeAt(runEnd) : -1;
      if (next >= 0x30 && next <= 0x39) {
        pos++;
        continue; // closing `$` followed by a digit — currency guard
      }
      close = pos;
      break;
    }
    if (close < 0) {
      start++;
      continue;
    }
    out.push({ from: start, to: close + 1, tex: src.slice(start + 1, close) });
    start = close + 1;
  }
  return out;
}

/* ================= widgets ================= */

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-live-checkbox";
    box.checked = this.checked;
    box.setAttribute("data-testid", "live-task-checkbox");
    box.setAttribute(
      "aria-label",
      this.checked ? t("editor.taskMarkIncomplete") : t("editor.taskMarkComplete"),
    );
    // mousedown would move the cursor into the line and reveal the raw syntax
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      // the widget replaces "[ ]"/"[x]" (plus trailing space) starting at pos
      if (view.state.sliceDoc(pos, pos + 1) !== "[") return;
      const cur = view.state.sliceDoc(pos + 1, pos + 2);
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: /[xX]/.test(cur) ? " " : "x" },
      });
    });
    return box;
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-bullet";
    span.textContent = "•";
    return span;
  }
}

class HrWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-live-hr";
    el.setAttribute("data-testid", "live-hr");
    return el;
  }
}

/**
 * Inline image embed for `![[img.png]]` (R11). toDOM returns synchronously;
 * the blob URL resolves async and is only applied if the img is still in the
 * document. NEVER writes document content — display only.
 */
class EmbedWidget extends WidgetType {
  constructor(
    readonly app: GeodeApp,
    readonly resolvedPath: string,
    // R61: dimensions from a numeric alias (`![[img|200]]` / `|200x100`),
    // mirroring the reading-view <img width/height>. undefined ⇒ intrinsic.
    readonly width?: number,
    readonly height?: number,
  ) {
    super();
  }
  override eq(other: EmbedWidget): boolean {
    return (
      other.resolvedPath === this.resolvedPath &&
      other.width === this.width &&
      other.height === this.height
    );
  }
  override toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.className = "cm-live-embed";
    img.alt = this.resolvedPath;
    if (this.width !== undefined) img.width = this.width;
    if (this.height !== undefined) img.height = this.height;
    // a blob URL revoked while loading surfaces as an error event
    img.addEventListener("error", () => img.classList.add("geode-embed-failed"), { once: true });
    getEmbedUrl(this.app, this.resolvedPath).then(
      (url) => {
        // the widget may have been dropped while the binary read was in flight
        if (img.isConnected) img.src = url;
      },
      () => img.classList.add("geode-embed-failed"),
    );
    return img;
  }
}

/**
 * Inline media file embed for `![[a.mp3]]` / `![[v.mp4]]` / `![[doc.pdf]]`
 * (R26). Mirrors EmbedWidget: toDOM returns synchronously and the blob URL
 * resolves async, applied only if the element is still in the document. The
 * element kind is derived from the extension — audio → <audio controls>,
 * video → <video controls>, pdf → <iframe> (native viewer; a `#page=N`
 * subpath rides on the src as a page anchor). NEVER writes document content.
 */
class FileEmbedWidget extends WidgetType {
  constructor(
    readonly app: GeodeApp,
    readonly resolvedPath: string,
    readonly ext: string,
    readonly subpath: string,
  ) {
    super();
  }
  override eq(other: FileEmbedWidget): boolean {
    return (
      other.resolvedPath === this.resolvedPath &&
      other.ext === this.ext &&
      other.subpath === this.subpath
    );
  }
  override toDOM(): HTMLElement {
    const kind = fileEmbedKind(this.ext);
    let el: HTMLMediaElement | HTMLIFrameElement;
    if (kind === "pdf") {
      const f = document.createElement("iframe");
      f.className = "cm-live-embed geode-embed-pdf";
      el = f;
    } else if (kind === "video") {
      const v = document.createElement("video");
      v.className = "cm-live-embed geode-embed-media";
      v.controls = true;
      el = v;
    } else {
      const a = document.createElement("audio");
      a.className = "cm-live-embed geode-embed-media";
      a.controls = true;
      el = a;
    }
    // a blob URL revoked while loading surfaces as an error event
    el.addEventListener("error", () => el.classList.add("geode-embed-failed"), { once: true });
    getEmbedUrl(this.app, this.resolvedPath).then(
      (url) => {
        // the widget may have been dropped while the binary read was in flight
        if (!el.isConnected) return;
        // pdf page anchor (page=N) rides on the subpath, like the reading view
        el.src = kind === "pdf" && this.subpath ? `${url}#${this.subpath}` : url;
      },
      () => el.classList.add("geode-embed-failed"),
    );
    return el;
  }
}

/**
 * Inline note transclusion for `![[note]]` / `![[note#Heading]]` (R12).
 * toDOM returns a synchronous container; a reading-view-isomorphic
 * placeholder span is hydrated off-DOM by the shared core engine and mounted
 * only if the container is still in the document. Internal links inside the
 * hydrated content navigate through the shared wikilink opener. NEVER writes
 * document content — display only.
 */
class NoteEmbedWidget extends WidgetType {
  constructor(
    readonly app: GeodeApp,
    readonly getPath: () => string,
    readonly resolvedPath: string,
    readonly subpath: string,
    readonly display: string,
  ) {
    super();
  }
  override eq(other: NoteEmbedWidget): boolean {
    return (
      other.resolvedPath === this.resolvedPath &&
      other.subpath === this.subpath &&
      other.display === this.display
    );
  }
  override toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-live-embed-note";
    // placeholder isomorphic to the reading-view pipeline output — the core
    // engine expands span.geode-embed-note in place on a detached host, and
    // the result is mounted only if the widget is still in the document
    const placeholder = document.createElement("span");
    placeholder.className = "geode-embed-note";
    placeholder.dataset.embedNote = this.resolvedPath;
    placeholder.dataset.embedSubpath = this.subpath;
    placeholder.dataset.embedDisplay = this.display;
    const host = document.createElement("span");
    host.appendChild(placeholder);
    void coreHydrateEmbeds(host, {
      vault: this.app.vault,
      metadata: this.app.metadata,
      imageSrc: (p: string) => getEmbedUrl(this.app, p),
      ancestors: new Set([this.getPath()]),
    }).then(() => {
      // the widget may have been dropped while the vault reads were in flight
      if (!container.isConnected) return;
      while (host.firstChild) container.appendChild(host.firstChild);
    });
    // click delegation: internal links open through the shared wikilink
    // opener; preventDefault blocks CM selection side effects on the click.
    // data-subpath is set by the core render pipeline on subpath-bearing
    // anchors — threading it makes [[note#Heading]] reveal the span (R14).
    container.addEventListener("click", (e) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const link = el?.closest<HTMLAnchorElement>("a.internal-link");
      if (!link || !container.contains(link)) return;
      e.preventDefault();
      const target = link.dataset.target;
      const subpath = link.dataset.subpath;
      // R16: an empty data-target with a data-subpath is a [[#h]] self-link —
      // still navigable (opens the host note and reveals the span)
      if (target !== undefined && (target !== "" || subpath)) {
        void openWikilink(this.app, target, this.getPath(), subpath);
      }
    });
    return container;
  }
}

/**
 * KaTeX math widget for `$inline$` and single-line `$$display$$` (R18).
 * toDOM returns a synchronous placeholder span showing the raw TeX; KaTeX
 * loads lazily through the shared core loader and the rendered output is
 * applied only if the placeholder is still in the document (the view may
 * have been destroyed / the widget dropped while the import was in flight).
 * Unsupported macros degrade to the red raw-text fallback — never throws.
 * eq() compares tex + displayMode so unrelated redecorations do not rebuild
 * (and re-render) the widget. Display only: never writes the document.
 */
class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly displayMode: boolean,
  ) {
    super();
  }
  override eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.displayMode === this.displayMode;
  }
  // LP-5: WidgetType.ignoreEvent defaults to true, which makes CM treat clicks
  // on the rendered formula as "not belonging to the editor" — the selection
  // never moves to reveal the source, and drop/paste landing on the widget
  // (R17 attachmentIngest) get swallowed. Returning false lets the click place
  // the cursor (revealing the raw TeX) and lets domEventHandlers fire.
  override ignoreEvent(): boolean {
    return false;
  }
  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-math";
    span.textContent = this.tex;
    loadKatex().then(
      (katex) => {
        if (!span.isConnected) return; // dropped while katex was loading
        try {
          span.textContent = "";
          katex.render(this.tex, span, {
            displayMode: this.displayMode,
            throwOnError: false,
            output: "html",
            // SEC-01: bound user-controllable \rule/\kern sizes so a malicious
            // note can't freeze the renderer with a multi-million-px element
            // (matches the reading/export path in core/embeds.ts)
            maxSize: 100,
          });
        } catch {
          // non-parse errors can still throw despite throwOnError:false
          span.textContent = this.tex;
          span.classList.add("geode-math-error");
        }
      },
      () => span.classList.add("geode-math-error"), // load failure: keep raw TeX
    );
    return span;
  }
}

class FrontmatterWidget extends WidgetType {
  constructor(
    readonly count: number,
    readonly revealPos: number,
  ) {
    super();
  }
  override eq(other: FrontmatterWidget): boolean {
    return other.count === this.count && other.revealPos === this.revealPos;
  }
  override toDOM(view: EditorView): HTMLElement {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "cm-live-frontmatter";
    pill.setAttribute("data-testid", "live-frontmatter-pill");
    pill.title = t("editor.editProperties");
    pill.textContent = t(this.count === 1 ? "editor.propertiesOne" : "editor.propertiesMany", {
      count: this.count,
    });
    pill.addEventListener("mousedown", (e) => e.preventDefault());
    pill.addEventListener("click", (e) => {
      e.preventDefault();
      // moving the selection into the block reveals the raw YAML
      view.dispatch({
        selection: { anchor: Math.min(this.revealPos, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });
    return pill;
  }
}

/**
 * Properties panel host (R22): a block widget that adopts the stable per-pane
 * container EditorPane portals the React PropertiesPanel into. The container
 * OUTLIVES the widget DOM — toDOM only wraps and re-appends it, so the portal
 * content (focus state, React tree) survives CM dropping/rebuilding the
 * widget. eq() is constant-true (one stable container per view — Facet value
 * never changes for a built view), ignoreEvent() constant-true (panel events
 * belong to React, never to CM selection handling).
 */
class PropertiesHostWidget extends WidgetType {
  constructor(readonly host: HTMLElement) {
    super();
  }
  override eq(): boolean {
    return true;
  }
  override ignoreEvent(): boolean {
    return true;
  }
  override get estimatedHeight(): number {
    return 120;
  }
  override toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-properties-host";
    wrap.appendChild(this.host);
    return wrap;
  }
}

/** "hidden" display setting (R22): the frontmatter block is replaced with a
 *  zero-content widget — visually nothing, source mode is the editing entry. */
class HiddenFrontmatterWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override ignoreEvent(): boolean {
    return true;
  }
  override get estimatedHeight(): number {
    return 0;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-properties-hidden";
    el.style.display = "none";
    return el;
  }
}

/* ============ frontmatter block (StateField — block decoration) ============ */

function frontmatterDeco(state: EditorState, app: GeodeApp): DecorationSet {
  const doc = state.doc;
  const fmEnd = frontmatterEnd(state);
  if (fmEnd === 0) return Decoration.none;
  // replace up to the end of the closing "---" line, keeping its newline
  const blockTo = doc.lineAt(Math.max(0, fmEnd - 1)).to;

  const host = state.facet(propertiesHostFacet);
  if (host) {
    // R22 panel path. The selection entering the block NO LONGER reveals the
    // raw YAML — the panel is the editing surface ("visible") or source mode
    // is ("hidden"/"source"). CM skips block replaces natively on vertical
    // cursor motion, so keyboard navigation hops over the widget.
    switch (app.workspace.propertiesInDocument.get()) {
      case "source":
        return Decoration.none; // raw YAML always visible
      case "hidden":
        return Decoration.set([
          Decoration.replace({ widget: new HiddenFrontmatterWidget(), block: true }).range(
            0,
            blockTo,
          ),
        ]);
      case "visible":
        return Decoration.set([
          Decoration.replace({ widget: new PropertiesHostWidget(host), block: true }).range(
            0,
            blockTo,
          ),
        ]);
    }
  }

  // Degraded pill path (no host: compat / isolated call sites) — pre-R22
  // behaviour byte-for-byte, including the selection-touch reveal.
  const fm = parseFrontmatter(doc.sliceString(0, Math.min(doc.length, 20_000)));
  if (!fm) return Decoration.none;
  if (selectionTouches(state, 0, blockTo)) return Decoration.none; // revealed
  const firstLineEnd = doc.lineAt(0).to;
  return Decoration.set([
    Decoration.replace({
      widget: new FrontmatterWidget(
        Object.keys(fm.fields).length,
        Math.min(firstLineEnd + 1, doc.length),
      ),
      block: true,
    }).range(0, blockTo),
  ]);
}

/** Field factory (R22): the decoration depends on the workspace preference, so
 *  the field closes over `app` instead of being module-level. EditorPane
 *  dispatches `refreshProperties` when the preference store changes. */
function buildFrontmatterField(app: GeodeApp) {
  return StateField.define<DecorationSet>({
    create: (state) => frontmatterDeco(state, app),
    update(deco, tr) {
      if (
        tr.docChanged ||
        tr.selection ||
        tr.effects.some((e) => e.is(refreshProperties))
      ) {
        return frontmatterDeco(tr.state, app);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

/* ================= inline decoration computation (ViewPlugin) ================= */

const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;

/** Trailing block id marker, e.g. " ^quote-1" (R13 frozen contract regex). */
const BLOCK_MARK_RE = /\s\^([A-Za-z0-9-]+)\s*$/;

/** R18 frozen callout title regex (contract) — matched against the first
 *  blockquote line's content AFTER the leading "> " quote markers. */
const CALLOUT_RE = /^\[!([A-Za-z0-9_-]+)\]([+-]?)(?:[ \t]+(.*))?$/;

/** ==highlight== — single line, both delimiters hugging non-whitespace. */
const HIGHLIGHT_RE = /==(\S(?:[^\n]*?\S)?)==/g;

/** [^id] footnote reference (id charset frozen by the pipeline contract). */
const FOOTNOTE_RE = /\[\^([^\s[\]]+)\]/g;

// Inline `$...$` math is scanned by scanInlineMath() (mirrors the core/markdown
// inline rule with backslash-parity escaping on BOTH delimiters — CONTRACT-04).

/** Single-line `$$x$$` display math, anchored to mirror the reading pipeline's
 *  block rule (LP-1): line-leading `$$` at indent ≤3, closing `$$` followed by
 *  only trailing whitespace to end-of-line. Per-line scan (not a slice scan) so
 *  `foo $$x$$ bar` / `$$x$$ tail` / indent-≥4 forms stay literal like reading. */
const SINGLE_LINE_BLOCK_MATH_RE = /^ {0,3}\$\$([^$\n]+?)\$\$[ \t]*$/;

interface Spec {
  from: number;
  to: number;
  deco: Decoration;
}

const lineDeco = (cls: string) => Decoration.line({ class: cls });

function computeDecorations(
  view: EditorView,
  app: GeodeApp,
  getPath: () => string,
): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const fmEnd = frontmatterEnd(state);
  /** replace decorations — must not overlap, filtered after collection */
  const replaces: Spec[] = [];
  /** mark + line decorations — may overlap freely */
  const others: Spec[] = [];

  const hide = (from: number, to: number) => {
    if (from >= to) return;
    replaces.push({ from, to, deco: Decoration.replace({}) });
  };

  /** line numbers inside FencedCode nodes — block-marker hiding skips them */
  const fencedLines = new Set<number>();
  /** line numbers inside indented CodeBlock nodes — highlight/footnote/math
   *  scans skip them too, so `==`/`[^id]`/`$..$` inside indented code stay
   *  literal like the reading view (LP-1 unified exclusion). */
  const indentedCodeLines = new Set<number>();
  /** setext underline lines (`====` / `----`, lezer HeaderMark under
   *  SetextHeading) — the highlight scan must not chew the `=` run (LP-4). */
  const setextLines = new Set<number>();
  /** spans of every `[[...]]` wikilink match (document coords) — the highlight
   *  scan skips `==` that falls inside one, mirroring the reading pipeline's
   *  wikilink-preprocessing precedence (LP-4). */
  const wikilinkSpans: { from: number; to: number }[] = [];
  /** lines owned by a callout blockquote — quoteline must not stack (R18) */
  const calloutLines = new Set<number>();
  /** lines tinted as cross-line %%comment%% blocks (R18) */
  const commentLines = new Set<number>();
  /** lines tinted as cross-line $$math$$ blocks (R18) */
  const mathBlockLines = new Set<number>();
  for (const range of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        // the frontmatter region is fully managed by frontmatterField (the
        // markdown parser sees stray HorizontalRule/SetextHeading nodes in
        // the YAML) — skip everything inside it
        if (fmEnd > 0 && node.from < fmEnd && node.name !== "Document") {
          return node.to > fmEnd; // descend only if the node spills past it
        }

        switch (node.name) {
          case "HeaderMark": {
            const parent = node.node.parent;
            if (parent && parent.name.startsWith("SetextHeading")) {
              // the underline (`====` / `----`); record so the highlight scan
              // never splits a `=====` run into ==…== marks (LP-4)
              setextLines.add(doc.lineAt(node.from).number);
              break;
            }
            if (!parent || !parent.name.startsWith("ATXHeading")) break;
            if (lineTouched(state, node.from)) break;
            const trailing = doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0;
            hide(node.from, node.to + trailing);
            break;
          }

          case "EmphasisMark":
          case "StrikethroughMark": {
            const parent = node.node.parent;
            if (!parent) break;
            if (selectionTouches(state, parent.from, parent.to)) break;
            hide(node.from, node.to);
            break;
          }

          case "CodeMark": {
            const parent = node.node.parent;
            if (!parent || parent.name !== "InlineCode") break; // keep fences visible
            if (selectionTouches(state, parent.from, parent.to)) break;
            hide(node.from, node.to);
            break;
          }

          case "Link": {
            // skip wikilink-shaped spans ("[[x]]" parses as a nested Link)
            if (
              doc.sliceString(node.from, node.from + 2) === "[[" ||
              doc.sliceString(Math.max(0, node.from - 1), node.from) === "["
            ) {
              break;
            }
            if (selectionTouches(state, node.from, node.to)) break;
            const marks: { from: number; to: number }[] = [];
            let url: string | null = null;
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
              else if (child.name === "URL") url = doc.sliceString(child.from, child.to);
            }
            // only collapse well-formed single-line inline links: [text](url)
            if (marks.length < 4 || url === null) break;
            if (doc.lineAt(node.from).number !== doc.lineAt(node.to).number) break;
            hide(marks[0].from, marks[0].to); // "["
            hide(marks[1].from, marks[3].to); // "](url…)"
            const textFrom = marks[0].to;
            const textTo = marks[1].from;
            if (textFrom < textTo) {
              others.push({
                from: textFrom,
                to: textTo,
                deco: Decoration.mark({
                  class: "cm-live-mdlink",
                  attributes: { "data-url": url, title: url },
                }),
              });
            }
            break;
          }

          case "Task": {
            const marker = node.node.getChild("TaskMarker");
            if (!marker) break;
            const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
            const line = doc.lineAt(node.from);
            others.push({
              from: line.from,
              to: line.from,
              deco: lineDeco(checked ? "cm-live-task cm-live-task-done" : "cm-live-task"),
            });
            if (selectionTouches(state, line.from, line.to)) break;
            // hide the "- " list mark in front of the checkbox (Obsidian style)
            const listMark = node.node.parent?.getChild("ListMark");
            if (listMark && listMark.to <= marker.from) {
              const sp = doc.sliceString(listMark.to, listMark.to + 1) === " " ? 1 : 0;
              hide(listMark.from, listMark.to + sp);
            }
            const trailing = doc.sliceString(marker.to, marker.to + 1) === " " ? 1 : 0;
            replaces.push({
              from: marker.from,
              to: marker.to + trailing,
              deco: Decoration.replace({ widget: new CheckboxWidget(checked) }),
            });
            break;
          }

          case "ListMark": {
            const parent = node.node.parent;
            if (!parent || parent.name !== "ListItem") break;
            if (node.node.nextSibling?.name === "Task") break; // handled by Task
            const ordered = parent.parent?.name === "OrderedList";
            if (ordered) {
              // numbered lists keep their numbers, just accent-styled
              others.push({
                from: node.from,
                to: node.to,
                deco: Decoration.mark({ class: "cm-live-listnum" }),
              });
              break;
            }
            if (lineTouched(state, node.from)) break;
            if (node.to - node.from === 1) {
              replaces.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new BulletWidget() }),
              });
            }
            break;
          }

          case "Blockquote": {
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            // R18 callout: when the first line's content (after the "> "
            // markers) matches the frozen title regex, the whole blockquote
            // gets callout line decorations INSTEAD of quoteline (branch
            // split — stacking both is a visual conflict, contract口径).
            const firstLine = doc.line(first);
            // LP-2: strip exactly ONE `>` level — the one this Blockquote node
            // owns (its `node.from` sits at this level's `>`). Stripping ALL
            // levels made an OUTER plain blockquote whose first line opens a
            // nested callout (`> > [!tip]`) itself match CALLOUT_RE, painting
            // every outer line (incl. trailing plain paragraphs) as a callout.
            const nodeOffset = Math.max(0, node.from - firstLine.from);
            const afterNode = firstLine.text.slice(nodeOffset);
            const oneQuote = /^[ \t]*>[ \t]?/.exec(afterNode);
            const contentStart = nodeOffset + (oneQuote ? oneQuote[0].length : 0);
            const cm = CALLOUT_RE.exec(firstLine.text.slice(contentStart));
            if (cm) {
              const type = cm[1].toLowerCase();
              for (let n = first; n <= last; n++) {
                const line = doc.line(n);
                calloutLines.add(n);
                others.push({
                  from: line.from,
                  to: line.from,
                  deco: Decoration.line({
                    class:
                      n === first ? "cm-callout-line cm-callout-line-title" : "cm-callout-line",
                    attributes: { "data-callout": type },
                  }),
                });
              }
              // hide the "[!type]±" marker (plus separating whitespace)
              // unless the selection touches the title line; the ">" mark
              // stays on the existing QuoteMark hiding path (untouched)
              if (!lineTouched(state, firstLine.from)) {
                const markFrom = firstLine.from + contentStart;
                let markTo = markFrom + 2 + cm[1].length + 1 + cm[2].length;
                while (markTo < firstLine.to && /[ \t]/.test(doc.sliceString(markTo, markTo + 1))) {
                  markTo++;
                }
                hide(markFrom, markTo);
              }
              break;
            }
            for (let n = first; n <= last; n++) {
              // a plain quote nested inside a callout keeps the callout look
              if (calloutLines.has(n)) continue;
              const line = doc.line(n);
              others.push({ from: line.from, to: line.from, deco: lineDeco("cm-live-quoteline") });
            }
            break;
          }

          case "QuoteMark": {
            if (lineTouched(state, node.from)) break;
            const sp = doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0;
            hide(node.from, node.to + sp);
            break;
          }

          case "HorizontalRule": {
            if (lineTouched(state, node.from)) break;
            replaces.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new HrWidget() }),
            });
            break;
          }

          case "FencedCode": {
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            for (let n = first; n <= last; n++) {
              fencedLines.add(n); // marker hiding must not touch fence content (R13 contract)
              const line = doc.line(n);
              let cls = "cm-live-codeline";
              if (n === first) cls += " cm-live-codeline-first";
              if (n === last) cls += " cm-live-codeline-last";
              others.push({ from: line.from, to: line.from, deco: lineDeco(cls) });
            }
            break;
          }

          case "CodeBlock": {
            // indented (4-space) code block — literal text in the reading view;
            // record its lines so the regex scans below skip them (LP-1).
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            for (let n = first; n <= last; n++) indentedCodeLines.add(n);
            break;
          }
        }
        return undefined;
      },
    });

    /* ---- %%comments%% (R18 — line state machine over the visible range) ---- */
    // Scope is the visible range: an opener ABOVE the viewport is not seen,
    // so cross-line tinting starts at the first visible delimiter line
    // (accepted approximation, recorded as-built). Fence lines keep %%
    // literal and never toggle the state; same-line pairs hide inline.
    const rangeFirstLine = doc.lineAt(range.from).number;
    const rangeLastLine = doc.lineAt(range.to).number;
    let inComment = false;
    for (let n = rangeFirstLine; n <= rangeLastLine; n++) {
      if (fencedLines.has(n)) continue;
      const line = doc.line(n);
      if (line.from < fmEnd) continue;
      let tinted = false;
      const tint = () => {
        if (tinted) return;
        tinted = true;
        commentLines.add(n);
        others.push({ from: line.from, to: line.from, deco: lineDeco("cm-live-comment-line") });
      };
      if (inComment) tint();
      // LP-3: only `%%` in the non-code (backtick-even) segments toggle/strip —
      // a single `%%` inside an inline-code span (`` `a %% b` ``) must not open
      // a phantom comment block (it would tint + suppress every line below and
      // invert %% parity vs the reading pipeline).
      const delims = commentDelimOffsets(line.text);
      let di = 0;
      while (di < delims.length) {
        const i = delims[di];
        if (inComment) {
          // closing delimiter — the rest of the line renders normally
          inComment = false;
          di++;
          continue;
        }
        if (di + 1 < delims.length) {
          // same-line pair: hide the whole span unless the selection touches
          const j = delims[di + 1];
          const from = line.from + i;
          const to = line.from + j + 2;
          if (!selectionTouches(state, from, to)) hide(from, to);
          di += 2;
        } else {
          // unpaired opener: a cross-line comment block starts on this line
          inComment = true;
          tint();
          di++;
        }
      }
    }

    /* ---- cross-line $$math$$ blocks (R18 — line tinting, no widget) ---- */
    // ViewPlugins may not build cross-line replaces; blocks get monospace
    // faint line decorations instead (recorded live-vs-reading deviation).
    let inMathBlock = false;
    for (let n = rangeFirstLine; n <= rangeLastLine; n++) {
      if (fencedLines.has(n) || commentLines.has(n)) continue;
      const line = doc.line(n);
      if (line.from < fmEnd) continue;
      if (inMathBlock) {
        mathBlockLines.add(n);
        others.push({ from: line.from, to: line.from, deco: lineDeco("cm-live-math-line") });
        if (line.text.includes("$$")) inMathBlock = false;
        continue;
      }
      // opener: line-leading $$ (≤3 indent, pipeline contract) and no closer
      // on the same line (the single-line $$x$$ form is widget-replaced below)
      const opener = /^ {0,3}\$\$/.exec(line.text);
      if (opener && line.text.indexOf("$$", opener[0].length) < 0) {
        inMathBlock = true;
        mathBlockLines.add(n);
        others.push({ from: line.from, to: line.from, deco: lineDeco("cm-live-math-line") });
      }
    }

    /* ---- wikilinks [[target|alias]] + ![[embeds]] (regex — not a lezer node) ---- */
    const text = doc.sliceString(range.from, range.to);
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      const start = range.from + m.index;
      const end = start + m[0].length;
      if (m[0].includes("\n")) continue; // plugins may not hide line breaks
      if (start < fmEnd) continue;
      // R14 (R13 debt): fenced code is plain text — [[x]] / ![[x]] inside a
      // fence is neither decorated nor widget-replaced, matching the reading
      // view. Cross-line matches already bailed above, so the match start
      // line decides. Inline code stays asymmetric (recorded — Obsidian does
      // not decorate there either; future work).
      if (fencedLines.has(doc.lineAt(start).number)) continue;
      // LP-4: record the span so the highlight scan never treats `==` inside a
      // wikilink (e.g. collapsed `[[a==b==c]]`) as a highlight delimiter —
      // mirrors the reading pipeline's wikilink-preprocessing precedence.
      const isEmbed = doc.sliceString(Math.max(0, start - 1), start) === "!";
      wikilinkSpans.push({ from: isEmbed ? start - 1 : start, to: end });
      const target = wikilinkTarget(m[1]);
      if (!target) {
        // R16: [[#h]] self-link — falls through to the collapse branch below
        // with data-link-target="" (the click handler routes empty targets
        // back to this note). ![[#h]] embeds (out of scope) and subpath-less
        // empty targets keep the raw text, as before.
        const selfBody = m[1].split("|")[0];
        const selfHash = selfBody.indexOf("#");
        if (isEmbed || selfHash < 0 || !selfBody.slice(selfHash + 1)) continue;
      } else if (isEmbed) {
        // ![[...]] embed: replace the WHOLE match (incl. the "!") when the
        // selection does not touch it. Image attachments take precedence
        // (R11); otherwise a resolveLink hit means a note transclusion (R12);
        // unresolved / other targets keep the raw text.
        const embedFrom = start - 1;
        if (selectionTouches(state, embedFrom, end)) continue; // revealed for editing
        const resolved = app.metadata.resolveAttachment(target, getPath());
        const ext = resolved ? resolved.slice(resolved.lastIndexOf(".") + 1).toLowerCase() : "";
        if (resolved && IMAGE_EXTS.has(ext)) {
          // R61: a numeric alias (`|200` / `|200x100`) sizes the image —
          // parsed by the SAME helper the reading view uses (no drift).
          const imgPipe = m[1].indexOf("|");
          const imgSize = imgPipe >= 0 ? parseEmbedSize(m[1].slice(imgPipe + 1)) : null;
          replaces.push({
            from: embedFrom,
            to: end,
            deco: Decoration.replace({
              widget: new EmbedWidget(app, resolved, imgSize?.width, imgSize?.height),
            }),
          });
          continue;
        }
        if (resolved && fileEmbedKind(ext)) {
          // R26: audio/video/pdf media embed. subpath = raw text between "#"
          // and "|" (carries PDF `page=N`), derived like the note-embed path.
          const mediaBody = m[1].split("|")[0];
          const mediaHash = mediaBody.indexOf("#");
          const mediaSubpath = mediaHash >= 0 ? mediaBody.slice(mediaHash + 1) : "";
          replaces.push({
            from: embedFrom,
            to: end,
            deco: Decoration.replace({
              widget: new FileEmbedWidget(app, resolved, ext, mediaSubpath),
            }),
          });
          continue;
        }
        const note = app.metadata.resolveLink(target, getPath());
        if (!note) continue; // unresolved: raw text
        // subpath = raw text between "#" and "|"; display = alias, else the
        // pre-pipe inner text (mirrors the reading-view placeholder contract)
        const rawBody = m[1].split("|")[0];
        const hashIdx = rawBody.indexOf("#");
        const subpath = hashIdx >= 0 ? rawBody.slice(hashIdx + 1) : "";
        const pipeIdx = m[1].indexOf("|");
        const alias = pipeIdx >= 0 ? m[1].slice(pipeIdx + 1).trim() : "";
        const display = alias || rawBody.trim();
        replaces.push({
          from: embedFrom,
          to: end,
          deco: Decoration.replace({
            widget: new NoteEmbedWidget(app, getPath, note, subpath, display),
          }),
        });
        continue;
      }
      if (selectionTouches(state, start, end)) continue; // revealed: raw text
      const pipe = m[1].indexOf("|");
      hide(start, start + 2); // "[["
      if (pipe >= 0) hide(start + 2, start + 2 + pipe + 1); // "target|"
      hide(end - 2, end); // "]]"
      const visFrom = pipe >= 0 ? start + 2 + pipe + 1 : start + 2;
      if (visFrom < end - 2) {
        // subpath = raw text between "#" and "|" — threaded to openWikilink
        // by the click handler so [[note#Heading]] scrolls to the span (R14)
        const linkBody = pipe >= 0 ? m[1].slice(0, pipe) : m[1];
        const linkHash = linkBody.indexOf("#");
        const linkSubpath = linkHash >= 0 ? linkBody.slice(linkHash + 1) : "";
        const attributes: Record<string, string> = { "data-link-target": target };
        if (linkSubpath) attributes["data-link-subpath"] = linkSubpath;
        others.push({
          from: visFrom,
          to: end - 2,
          deco: Decoration.mark({ class: "cm-live-wikilink", attributes }),
        });
      }
    }

    /* ---- ==highlights== (R18 — single-line regex scan) ---- */
    // The content mark stays even while the selection touches the span
    // (Obsidian keeps the highlight while editing); only the == delimiters
    // un-hide. Fence / frontmatter / comment-block / math-block / indented-code
    // lines are excluded; inline code stays asymmetric like the wikilink scan.
    // LP-4: setext underline lines (`=====`) and `==` falling inside a wikilink
    // span are skipped so we don't shred a heading underline or a collapsed
    // `[[a==b==c]]` display text.
    HIGHLIGHT_RE.lastIndex = 0;
    while ((m = HIGHLIGHT_RE.exec(text)) !== null) {
      const start = range.from + m.index;
      const end = start + m[0].length;
      if (start < fmEnd) continue;
      const lineNo = doc.lineAt(start).number;
      if (
        fencedLines.has(lineNo) ||
        indentedCodeLines.has(lineNo) ||
        commentLines.has(lineNo) ||
        mathBlockLines.has(lineNo) ||
        setextLines.has(lineNo)
      ) {
        continue;
      }
      if (wikilinkSpans.some((s) => start < s.to && end > s.from)) continue;
      if (!selectionTouches(state, start, end)) {
        hide(start, start + 2);
        hide(end - 2, end);
      }
      others.push({
        from: start + 2,
        to: end - 2,
        deco: Decoration.mark({ class: "cm-live-highlight" }),
      });
    }

    /* ---- footnote references [^id] (R18 — superscript mark, no hiding) ---- */
    // Definition lines ("[^id]:" at line start) and inline footnotes ^[text]
    // get ZERO live treatment (official live-preview behaviour).
    FOOTNOTE_RE.lastIndex = 0;
    while ((m = FOOTNOTE_RE.exec(text)) !== null) {
      const start = range.from + m.index;
      const end = start + m[0].length;
      if (start < fmEnd) continue;
      const line = doc.lineAt(start);
      if (fencedLines.has(line.number) || indentedCodeLines.has(line.number)) continue;
      if (commentLines.has(line.number) || mathBlockLines.has(line.number)) continue;
      if (start === line.from && doc.sliceString(end, end + 1) === ":") continue; // definition
      others.push({
        from: start,
        to: end,
        deco: Decoration.mark({ class: "cm-live-footnote-ref" }),
      });
    }

    /* ---- math widgets: single-line $$x$$ (per-line) then inline $x$ ---- */
    const mathExcluded = (lineNo: number) =>
      fencedLines.has(lineNo) ||
      indentedCodeLines.has(lineNo) ||
      commentLines.has(lineNo) ||
      mathBlockLines.has(lineNo);

    // LP-1: single-line `$$x$$` is matched PER LINE against an anchored regex
    // (line-leading `$$` ≤3 indent, closer followed by only trailing space) so
    // `foo $$x$$ bar` / `$$x$$ tail` / indent-≥4 forms stay literal exactly as
    // the reading pipeline's block rule decides — no more slice-wide scanning.
    for (let n = rangeFirstLine; n <= rangeLastLine; n++) {
      if (mathExcluded(n)) continue;
      const line = doc.line(n);
      if (line.from < fmEnd) continue;
      const bm = SINGLE_LINE_BLOCK_MATH_RE.exec(line.text);
      if (!bm) continue;
      const openIdx = line.text.indexOf("$$");
      const closeIdx = line.text.lastIndexOf("$$");
      const start = line.from + openIdx;
      const end = line.from + closeIdx + 2;
      if (selectionTouches(state, start, end)) continue; // revealed for editing
      replaces.push({
        from: start,
        to: end,
        deco: Decoration.replace({ widget: new MathWidget(bm[1], true) }),
      });
    }

    // inline `$x$` via the escape-aware scanner (CONTRACT-04). It runs after
    // the block pass so a `$$x$$` line is already claimed; the scanner treats
    // `$$` runs as inert anyway, and the merge pass drops any nested replace.
    for (const im of scanInlineMath(text)) {
      const start = range.from + im.from;
      const end = range.from + im.to;
      if (start < fmEnd) continue;
      const lineNo = doc.lineAt(start).number;
      if (mathExcluded(lineNo)) continue;
      if (selectionTouches(state, start, end)) continue; // revealed for editing
      replaces.push({
        from: start,
        to: end,
        deco: Decoration.replace({ widget: new MathWidget(im.tex, false) }),
      });
    }

    /* ---- trailing block id markers " ^id" (R13) ---- */
    // Per-line scan. Fenced code is EXCLUDED (R13 contract: "fence 内不处理" —
    // mirrors the reading-view strip in core/markdown.ts and the block index,
    // which both ignore fence interiors; fencedLines was collected from the
    // FencedCode syntax nodes above). The hide span starts at the matched
    // leading whitespace and runs to line end; selection anywhere on the line
    // reveals the raw marker. The merge pass below drops it if a wider
    // replace (embed widget, …) already covers it.
    const firstLine = doc.lineAt(range.from).number;
    const lastLine = doc.lineAt(range.to).number;
    for (let n = firstLine; n <= lastLine; n++) {
      if (fencedLines.has(n)) continue; // fence content is never a block marker
      const line = doc.line(n);
      if (line.from < fmEnd) continue; // frontmatter is owned by the frontmatter field (pill/panel)
      const bm = BLOCK_MARK_RE.exec(line.text);
      if (!bm) continue;
      const markFrom = line.from + bm.index;
      if (lineTouched(state, markFrom)) continue; // cursor on the line: reveal
      hide(markFrom, line.from + bm.index + bm[0].length);
    }
  }

  /* ---- merge: replaces must not partially overlap (RangeSet errors) ---- */
  replaces.sort((a, b) => a.from - b.from || b.to - a.to);
  const kept: Spec[] = [];
  let lastEnd = -1;
  for (const spec of replaces) {
    if (spec.from < lastEnd) continue; // overlaps/nested in a previous replace
    kept.push(spec);
    lastEnd = spec.to;
  }

  const all = kept.concat(others);
  return Decoration.set(
    all.map((s) => s.deco.range(s.from, s.to)),
    true,
  );
}

/* ================= plugin + click navigation ================= */

function livePreviewPlugin(app: GeodeApp, getPath: () => string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = computeDecorations(view, app, getPath);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = computeDecorations(update.view, app, getPath);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/**
 * Plain click on a *collapsed* wikilink navigates (the cm-live-wikilink class
 * only exists while the link is collapsed; when the cursor is inside, the raw
 * text shows and Ctrl+Click — handled in cmExtensions — still navigates).
 * Ctrl+Click on a collapsed markdown link opens the URL externally.
 */
function liveClickHandler(app: GeodeApp, getPath: () => string): Extension {
  return EditorView.domEventHandlers({
    mousedown: (event) => {
      if (event.button !== 0) return false;
      const el = event.target instanceof HTMLElement ? event.target : null;
      if (!el) return false;

      const md = el.closest(".cm-live-mdlink");
      if (md && (event.ctrlKey || event.metaKey)) {
        const url = md.getAttribute("data-url");
        if (url) {
          event.preventDefault();
          // in Tauri the opener routes this to the OS browser
          window.open(url, "_blank", "noopener");
          return true;
        }
      }

      const wl = el.closest(".cm-live-wikilink");
      if (wl && !event.ctrlKey && !event.metaKey) {
        const target = wl.getAttribute("data-link-target");
        // subpath rides along so [[note#Heading]] reveals the span (R14);
        // R16: an empty target is a [[#h]] self-link — valid only when the
        // subpath attribute is present (defensive against stray marks)
        const subpath = wl.getAttribute("data-link-subpath");
        if (target !== null && (target !== "" || subpath)) {
          event.preventDefault();
          void openWikilink(app, target, getPath(), subpath ?? undefined);
          return true;
        }
      }
      return false;
    },
  });
}

const liveTheme = EditorView.theme({
  ".cm-live-mdlink": { cursor: "pointer" },
  ".cm-live-wikilink": { cursor: "pointer" },
});

/** The full live-preview extension set (only included when mode === "live").
 *  `getPath` is a live accessor — file:renamed retargets without a rebuild. */
export function livePreview(app: GeodeApp, getPath: () => string): Extension[] {
  const fmField = buildFrontmatterField(app);
  return [
    fmField,
    // R22 review fix (INT-3): the replaced fm range is atomic — cursor
    // motion treats the widget as a unit, so the caret can no longer be
    // parked invisibly inside the hidden region (empty set when revealed /
    // source display, so reveal flows are unaffected).
    EditorView.atomicRanges.of(
      (view) => view.state.field(fmField, false) ?? Decoration.none,
    ),
    // Backspace at the start of the first body line deletes the \n AFTER the
    // closing fence — parseFrontmatter then reads that body line AS the
    // closing fence and it silently vanishes into the widget (INT-3).
    // Swallow exactly that keypress while the block widget is active.
    Prec.high(
      keymap.of([
        {
          key: "Backspace",
          run: (view) => {
            const deco = view.state.field(fmField, false);
            if (!deco || deco.size === 0) return false;
            let end = -1;
            deco.between(0, view.state.doc.length, (_f, to) => {
              end = Math.max(end, to);
            });
            if (end < 0) return false;
            // R63: check EVERY range, not just selection.main — multi-cursor
            // (allowMultipleSelections) can park a SECONDARY empty cursor at the
            // protected first-body-line start (end+1); deleteCharBackward applies to
            // all ranges, so a main-only guard would let that cursor delete the
            // frontmatter closing-fence newline (reopens the INT-3 corruption).
            return view.state.selection.ranges.some((r) => r.empty && r.head === end + 1);
          },
        },
      ]),
    ),
    livePreviewPlugin(app, getPath),
    liveClickHandler(app, getPath),
    // R55 — render GFM pipe tables as <table>s in live preview (reveal source on
    // cursor/click). Block-replace widget + atomicRanges, like the frontmatter field.
    liveTables(app, getPath),
    // R56 — render ```mermaid fences as diagrams in live preview (same block-widget
    // machinery; renderMarkdownToHtml placeholder + hydrateEmbeds async SVG).
    liveMermaid(app, getPath),
    // R57 — render $$…$$ display-math blocks as KaTeX in live preview (same machinery;
    // scan-based ranges confirmed by the renderer + hydrateEmbeds math pass).
    liveMath(app, getPath),
    liveTheme,
  ];
}
