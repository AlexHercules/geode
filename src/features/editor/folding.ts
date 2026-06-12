/**
 * Heading/list folding (R17): codeFolding + foldGutter + a custom foldService
 * implementing the frozen semantics from ARCHITECTURE.md "Round 17 additions",
 * plus the standard fold keymap. Fold state lives in the EditorState, so a
 * live<->source compartment reconfigure keeps it; a view rebuild drops it
 * (explicit non-persistence, recorded in the contract).
 *
 * Frozen foldService semantics:
 * - heading: an ATXHeading1-6 node at line start (syntaxTree — headings inside
 *   fences are never parsed as headings) folds from the heading line's end to
 *   the section end: the end of the line before the next line-start ATXHeading
 *   with level <= the current one, or doc end when there is no successor.
 *   SetextHeading is out of scope this round.
 * - list item: a ListItem spanning more than one line folds from its first
 *   line's end to node.to (covering nested children/continuation lines);
 *   nested ListItems provide their own fold points on their own first lines.
 */
import {
  codeFolding,
  ensureSyntaxTree,
  foldCode,
  foldEffect,
  foldGutter,
  foldService,
  foldedRanges,
  syntaxTree,
  unfoldAll,
  unfoldCode,
} from "@codemirror/language";
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const ATX_HEADING_RE = /^ATXHeading([1-6])$/;

type FoldRange = { from: number; to: number } | null;

/** A heading node "owns" its line when only whitespace precedes it (ATX
 *  headings may be indented up to 3 spaces; "- # x" inside a list does not
 *  count — review fix: the previous exact line-start check made indented
 *  headings unfoldable AND invisible as section terminators). */
function ownsLine(state: EditorState, lineFrom: number, nodeFrom: number): boolean {
  return (
    state.doc.lineAt(nodeFrom).from === lineFrom &&
    state.doc.sliceString(lineFrom, nodeFrom).trim() === ""
  );
}

/**
 * End offset of the frontmatter block ("---" first line .. closing "---"/"...")
 * or 0 when the document has none. The markdown parser knows nothing about
 * YAML — a "# comment" inside frontmatter parses as a real ATXHeading, and
 * folding it would hide the whole body (review fix). Cached per doc identity
 * (Text is immutable; the gutter queries many lines against the same doc).
 */
const fmCache = new WeakMap<object, number>();
function frontmatterEnd(state: EditorState): number {
  const doc = state.doc;
  const cached = fmCache.get(doc);
  if (cached !== undefined) return cached;
  let end = 0;
  if (doc.lines > 1 && doc.line(1).text === "---") {
    for (let i = 2; i <= doc.lines; i++) {
      const l = doc.line(i);
      if (l.text === "---" || l.text === "...") {
        end = l.to;
        break;
      }
    }
  }
  fmCache.set(doc, end);
  return end;
}

/**
 * Section end for a heading of `level` whose line ends at `lineEnd`: the end
 * of the line preceding the next line-owning ATXHeading with level <= `level`,
 * or doc.length when no such heading follows. Cursor-based forward walk with
 * a real early exit (tree.iterate cannot abort across siblings — on large
 * documents that made every gutter query O(doc), review fix).
 */
function headingSectionEnd(state: EditorState, level: number, lineEnd: number): number {
  const doc = state.doc;
  const cursor = syntaxTree(state).cursorAt(lineEnd, 1);
  do {
    const m = ATX_HEADING_RE.exec(cursor.name);
    if (m && cursor.from > lineEnd && Number(m[1]) <= level) {
      const line = doc.lineAt(cursor.from);
      if (ownsLine(state, line.from, cursor.from)) {
        return doc.lineAt(line.from - 1).to;
      }
    }
  } while (cursor.next());
  return doc.length;
}

/**
 * A ListItem's node.to may land on the start of the following line (trailing
 * newline included) — back up to the previous line's end so folding never
 * swallows the next line.
 */
function trimTrailingNewline(state: EditorState, to: number): number {
  return to > 0 && state.doc.lineAt(to).from === to ? state.doc.lineAt(to - 1).to : to;
}

/** The frozen foldService: heading sections + multi-line list items. */
function markdownFoldRange(state: EditorState, lineStart: number, lineEnd: number): FoldRange {
  // frontmatter lines never fold — the parser sees YAML as markdown
  if (lineStart < frontmatterEnd(state)) return null;
  let result: FoldRange = null;
  syntaxTree(state).iterate({
    from: lineStart,
    to: lineEnd,
    enter: (n) => {
      if (result) return false;
      const heading = ATX_HEADING_RE.exec(n.name);
      if (heading && ownsLine(state, lineStart, n.from)) {
        const end = headingSectionEnd(state, Number(heading[1]), lineEnd);
        if (end > lineEnd) result = { from: lineEnd, to: end };
        // a heading line folds as a section or not at all
        return false;
      }
      // a ListItem whose first line is this line (n.from may sit after the
      // line's indentation, hence >= lineStart instead of === lineStart)
      if (n.name === "ListItem" && n.from >= lineStart) {
        const end = trimTrailingNewline(state, n.to);
        if (end > lineEnd) {
          result = { from: lineEnd, to: end };
          return false;
        }
        // single-line item — nothing nested on the same line reaches further
        return false;
      }
      return undefined;
    },
  });
  return result;
}

/** Gutter marker: a CSS chevron; `.is-folded` stays visible without hover. */
function foldMarker(open: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = open ? "cm-fold-marker" : "cm-fold-marker is-folded";
  return el;
}

/** codeFolding + foldGutter + the frozen foldService + fold keymap. The
 *  standard foldKeymap is NOT used: its Ctrl-Alt-[ binding calls the library
 *  foldAll, which would also fold fences/blockquotes/tables via the built-in
 *  foldNodeProp sources — the keyboard path must match editor:fold-all
 *  (frozen semantics only, review fix). */
export function markdownFolding(): Extension {
  return [
    codeFolding(),
    // high precedence: consulted before any other foldService
    Prec.high(foldService.of(markdownFoldRange)),
    foldGutter({ markerDOM: foldMarker }),
    keymap.of([
      { key: "Ctrl-Shift-[", mac: "Cmd-Alt-[", run: foldCode },
      { key: "Ctrl-Shift-]", mac: "Cmd-Alt-]", run: unfoldCode },
      {
        key: "Ctrl-Alt-[",
        run: (view) => {
          foldAllInView(view);
          return true;
        },
      },
      {
        key: "Ctrl-Alt-]",
        run: (view) => {
          unfoldAllInView(view);
          return true;
        },
      },
    ]),
  ];
}

/* ---------------- command entry points (App.tsx) ---------------- */

/** "Fold all headings and lists": scan with the FROZEN semantics only — the
 *  library foldAll would also fold fences/blockquotes/tables via the built-in
 *  foldNodeProp sources, which Obsidian does not do. */
export function foldAllInView(view: EditorView): void {
  const { state } = view;
  // the full-document scan needs a complete parse — syntaxTree() alone may
  // stop at the viewport on large documents (review fix; bounded at 500ms)
  ensureSyntaxTree(state, state.doc.length, 500);
  const folded = foldedRanges(state);
  const effects = [];
  for (let pos = 0; pos < state.doc.length; ) {
    const line = state.doc.lineAt(pos);
    const range = markdownFoldRange(state, line.from, line.to);
    if (range) {
      let already = false;
      folded.between(range.from, range.to, (f, t) => {
        if (f === range.from && t === range.to) {
          already = true;
          return false;
        }
      });
      if (!already) effects.push(foldEffect.of(range));
    }
    pos = line.to + 1;
  }
  if (effects.length) view.dispatch({ effects });
}

export function unfoldAllInView(view: EditorView): void {
  unfoldAll(view);
}

/** Cursor line has a folded range -> unfold, otherwise fold. */
export function toggleFoldAtCursor(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  let folded = false;
  foldedRanges(view.state).between(line.from, line.to, () => {
    folded = true;
    return false;
  });
  if (folded) unfoldCode(view);
  else foldCode(view);
}
