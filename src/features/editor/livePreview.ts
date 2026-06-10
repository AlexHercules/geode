/**
 * livePreview.ts — Obsidian-style live preview for the Geode editor.
 *
 * A ViewPlugin walks the markdown syntax tree over the visible ranges and
 * hides formatting characters (heading hashes, emphasis stars, link brackets,
 * quote marks, …) unless the selection touches the construct, in which case
 * the raw syntax is revealed for editing. Some marks are replaced with
 * interactive widgets (task checkboxes, bullets, horizontal rules).
 *
 * The frontmatter "Properties" pill is a block replace decoration spanning
 * line breaks, which CM6 forbids from view plugins — it lives in a StateField.
 *
 * TODO: images and ![[embeds]] are intentionally left as raw text this round.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { parseFrontmatter } from "@core/metadata";
import { openWikilink, wikilinkTarget } from "./wikilinks";

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
    box.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Mark task complete");
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
    pill.title = "Edit properties";
    pill.textContent = `Properties · ${this.count} ${this.count === 1 ? "field" : "fields"}`;
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

/* ================= frontmatter pill (StateField — block decoration) ================= */

function frontmatterDeco(state: EditorState): DecorationSet {
  const doc = state.doc;
  const fmEnd = frontmatterEnd(state);
  if (fmEnd === 0) return Decoration.none;
  const fm = parseFrontmatter(doc.sliceString(0, Math.min(doc.length, 20_000)));
  if (!fm) return Decoration.none;
  // replace up to the end of the closing "---" line, keeping its newline
  const blockTo = doc.lineAt(Math.max(0, fmEnd - 1)).to;
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

const frontmatterField = StateField.define<DecorationSet>({
  create: (state) => frontmatterDeco(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return frontmatterDeco(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ================= inline decoration computation (ViewPlugin) ================= */

const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;

interface Spec {
  from: number;
  to: number;
  deco: Decoration;
}

const lineDeco = (cls: string) => Decoration.line({ class: cls });

function computeDecorations(view: EditorView): DecorationSet {
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
            for (let n = first; n <= last; n++) {
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
              const line = doc.line(n);
              let cls = "cm-live-codeline";
              if (n === first) cls += " cm-live-codeline-first";
              if (n === last) cls += " cm-live-codeline-last";
              others.push({ from: line.from, to: line.from, deco: lineDeco(cls) });
            }
            break;
          }
        }
        return undefined;
      },
    });

    /* ---- wikilinks [[target|alias]] (regex — not a lezer node) ---- */
    const text = doc.sliceString(range.from, range.to);
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      const start = range.from + m.index;
      const end = start + m[0].length;
      if (m[0].includes("\n")) continue; // plugins may not hide line breaks
      // TODO: ![[embeds]] render as raw text this round — skip them here
      if (doc.sliceString(Math.max(0, start - 1), start) === "!") continue;
      if (start < fmEnd) continue;
      const target = wikilinkTarget(m[1]);
      if (!target) continue;
      if (selectionTouches(state, start, end)) continue; // revealed: raw text
      const pipe = m[1].indexOf("|");
      hide(start, start + 2); // "[["
      if (pipe >= 0) hide(start + 2, start + 2 + pipe + 1); // "target|"
      hide(end - 2, end); // "]]"
      const visFrom = pipe >= 0 ? start + 2 + pipe + 1 : start + 2;
      if (visFrom < end - 2) {
        others.push({
          from: visFrom,
          to: end - 2,
          deco: Decoration.mark({
            class: "cm-live-wikilink",
            attributes: { "data-link-target": target },
          }),
        });
      }
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

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = computeDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

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
        if (target) {
          event.preventDefault();
          void openWikilink(app, target, getPath());
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
  return [frontmatterField, livePreviewPlugin, liveClickHandler(app, getPath), liveTheme];
}
