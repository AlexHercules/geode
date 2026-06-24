/**
 * R33 markdown formatting commands — the CM dispatch + command-registration
 * layer over the pure transforms in core/format.ts. Registers Cmd/Ctrl-B/I/K
 * (bold/italic/link) plus toggle heading/quote/code/callout/list commands
 * (no default hotkey, matching Obsidian — bind via Settings).
 *
 * Layering: features/editor may import core + app/AppContext + app/icons. The
 * pure logic lives in core/format.ts; this module only bridges it to a live
 * EditorView. App.tsx injects `getView` (= getActiveFileEditorView → view) so
 * this module never reaches into App's private active-file resolver.
 *
 * Data safety: writes go through the normal CM transaction → documents.ts
 * dirty → autosave pipeline (NO new vault write path — inherits the B-class
 * write guards). `getView` resolves the ACTIVE-FILE view only, so a format
 * command can never mutate a background/non-active file (R23 DS-1).
 */
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { applyFormatOp, insertFootnote, type FormatOp } from "@core/format";
import { t, type I18nKey } from "@core/i18n";
import { findMathBlockRanges } from "./liveMath";

/** Inline math (`$…$`), conservatively: a single-line `$…$` with non-space-led content.
 *  Over-matching prose `$` only OVER-protects (skips clearing there) — never corrupts. */
const INLINE_MATH_RE = /\$(?!\s)(?:\\\$|[^$\n])+?\$/g;

/** `%%` delimiter offsets in a line's non-code (backtick-even) segments — mirrors
 *  core/markdown.ts commentDelimOffsets so a `%%` inside `` `code` `` never opens a comment. */
function commentDelims(line: string): number[] {
  const offsets: number[] = [];
  let base = 0;
  line.split(/(`+[^`]*`+)/g).forEach((seg, i) => {
    if (i % 2 === 0) {
      let at = seg.indexOf("%%");
      while (at >= 0) {
        offsets.push(base + at);
        at = seg.indexOf("%%", at + 2);
      }
    }
    base += seg.length;
  });
  return offsets;
}

const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;

/** `%%comment%%` spans (single-line + cross-line blocks), pairing `%%` delimiters
 *  left-to-right; an unpaired opener runs to the next closer (or EOF). Comment bodies are
 *  literal — their `*`/`~` must not be stripped. Mirrors core/markdown's R18 comment scan,
 *  including fence-awareness: a lone `%%` inside a fenced code block is literal, not a
 *  comment opener (else it would over-protect the rest of the doc). A comment already open
 *  takes precedence (a fence line inside it is comment content). Exported (R197) so
 *  delete-paragraph can treat a multi-line comment as one block.
 *  `pairedOnly` (R197) drops the trailing UNPAIRED `%%` opener's run-to-EOF span: that span
 *  exists only for clearFormatting's over-protection (harmless there), but delete-paragraph
 *  must not expand a deletion to EOF for a half-written comment — an unpaired `%%` has no
 *  closer to orphan, so the plain block delete is already byte-safe. */
export function commentSpans(state: EditorState, pairedOnly = false): Array<{ from: number; to: number }> {
  const doc = state.doc;
  const spans: Array<{ from: number; to: number }> = [];
  let open = -1; // doc offset of an unclosed `%%` opener, or -1
  let fence = ""; // active code-fence marker (``` / ~~~), or "" outside a fence
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const offs = commentDelims(line.text).map((o) => line.from + o);
    let k = 0;
    if (open >= 0) {
      if (offs.length === 0) continue; // whole line inside the block — covered by the close span
      spans.push({ from: open, to: offs[0] + 2 });
      open = -1;
      k = 1;
    } else {
      // outside a comment, fenced code makes `%%` literal (skip pairing on fence lines)
      const trimmed = line.text.trim();
      const fm = FENCE_OPEN_RE.exec(trimmed);
      if (fence) {
        if (fm && trimmed.startsWith(fence)) fence = "";
        continue;
      }
      if (fm) {
        fence = fm[1];
        continue;
      }
    }
    for (; k + 1 < offs.length; k += 2) spans.push({ from: offs[k], to: offs[k + 1] + 2 });
    if (k < offs.length) open = offs[k]; // unpaired opener → block continues
  }
  if (open >= 0 && !pairedOnly) spans.push({ from: open, to: doc.length });
  return spans;
}

/** R192: spans Geode renders as LITERAL but the Lezer GFM parser does not model, so it
 *  mis-parses their inner `*` / `~` as emphasis. Excluding any mark inside one keeps
 *  clear-formatting from corrupting math (`$a*b*c$`) or frontmatter values. Wikilinks /
 *  embeds / aliases ARE Lezer `Link`/`Image` nodes → handled by hasLinkAncestor instead. */
function protectedSpans(state: EditorState, from: number, to: number): Array<{ from: number; to: number }> {
  const doc = state.doc;
  const spans: Array<{ from: number; to: number }> = [];
  // frontmatter block (--- … --- / …) — values are literal YAML
  if (doc.lines >= 1 && doc.line(1).text === "---") {
    for (let i = 2; i <= doc.lines; i++) {
      const lt = doc.line(i).text;
      if (lt === "---" || lt === "...") {
        spans.push({ from: 0, to: doc.line(i).to });
        break;
      }
    }
  }
  // block math ($$…$$) — reuse the vetted detector==renderer scan
  for (const r of findMathBlockRanges(state)) spans.push(r);
  // %%comment%% bodies are literal (single-line + cross-line blocks)
  for (const r of commentSpans(state)) spans.push(r);
  // inline math ($…$) on each line the selection touches
  for (let ln = doc.lineAt(from).number; ln <= doc.lineAt(to).number; ln++) {
    const line = doc.line(ln);
    INLINE_MATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_MATH_RE.exec(line.text)) !== null) {
      spans.push({ from: line.from + m.index, to: line.from + m.index + m[0].length });
    }
  }
  return spans;
}

/** True when the node sits inside a Lezer Link/Image (wikilink `[[**x**]]`, embed
 *  `![[**x**]]`, alias `[[a|**b**]]`) — Geode treats the link target/alias as literal. */
function hasLinkAncestor(node: SyntaxNode): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.name === "Link" || p.name === "Image") return true;
  }
  return false;
}

/**
 * R192: clear inline formatting (bold/italic/strikethrough/inline code) from the
 * selection (Obsidian editor:clear-formatting). Walks the syntax tree so ONLY real mark
 * tokens are removed — and only for emphasis/code nodes FULLY inside the selection, so a
 * partial selection can never leave a half marker (no corruption). Because literal `*`
 * inside an InlineCode span is not an EmphasisMark, `` `a*b*c` `` clears to `a*b*c`, not
 * `abc`. Marks inside Geode's regex-overlay structures (wikilink/embed/alias via Link
 * ancestor; math / frontmatter / %%comment%% via protectedSpans) are EXCLUDED — Lezer
 * mis-parses their literal `*` as emphasis and removing it would corrupt link targets /
 * math / metadata / comment bodies (the overlay list mirrors the reading-view pre-pass).
 * Highlight (==) is regex-rendered (not a Lezer node) → deferred. Selection maps through
 * the deletions automatically. No-op (returns false) when nothing is stripped.
 */
export function clearFormatting(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (sel.empty) return false;
  const spans = protectedSpans(state, sel.from, sel.to);
  const inProtected = (f: number, t2: number) => spans.some((s) => f < s.to && t2 > s.from);
  const removals: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    from: sel.from,
    to: sel.to,
    enter(node) {
      if (
        node.name === "Emphasis" ||
        node.name === "StrongEmphasis" ||
        node.name === "Strikethrough" ||
        node.name === "InlineCode"
      ) {
        // fully inside the selection only — a partial node would unbalance its markers
        if (node.from < sel.from || node.to > sel.to) return;
        if (hasLinkAncestor(node.node)) return; // [[**x**]] / ![[..]] / [[a|**b**]]
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (
            (c.name === "EmphasisMark" || c.name === "StrikethroughMark" || c.name === "CodeMark") &&
            !inProtected(c.from, c.to)
          ) {
            removals.push({ from: c.from, to: c.to });
          }
        }
      }
    },
  });
  if (removals.length === 0) return false;
  // nested emphasis (***x***) yields an outer node's marks before its inner node's marks,
  // so sort by position — the changes array must be ordered + non-overlapping (marks never overlap).
  removals.sort((a, b) => a.from - b.from);
  view.dispatch({ changes: removals, userEvent: "input.format", scrollIntoView: true });
  return true;
}

/**
 * Apply a formatting op to the view's current selection. Reads the doc + main
 * selection, runs the pure transform, and dispatches a single atomic
 * transaction (changes + selection) when the transform returns an edit.
 * Returns true when an edit was dispatched.
 */
export function applyFormat(view: EditorView, op: FormatOp): boolean {
  const main = view.state.selection.main;
  const edit = applyFormatOp(op, view.state.doc.toString(), main.from, main.to);
  if (!edit) return false;
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.selFrom, head: edit.selTo },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  return true;
}

interface FormatCommandSpec {
  id: string;
  nameKey: I18nKey;
  op: FormatOp;
  hotkey?: string;
}

/** The R33 command set. Only bold/italic/link carry default hotkeys (Obsidian
 *  parity); the rest are unbound commands users may bind in Settings. */
const FORMAT_COMMANDS: ReadonlyArray<FormatCommandSpec> = [
  { id: "editor:toggle-bold", nameKey: "cmd.toggleBold", op: "bold", hotkey: "Mod+B" },
  { id: "editor:toggle-italic", nameKey: "cmd.toggleItalic", op: "italic", hotkey: "Mod+I" },
  { id: "editor:insert-link", nameKey: "cmd.insertLink", op: "link", hotkey: "Mod+K" },
  // R189: Obsidian "Insert wikilink" (`[[]]`), distinct from the Markdown link above (no default key)
  { id: "editor:insert-wikilink", nameKey: "cmd.insertWikilink", op: "wikilink" },
  { id: "editor:toggle-strikethrough", nameKey: "cmd.toggleStrikethrough", op: "strikethrough" },
  { id: "editor:toggle-highlight", nameKey: "cmd.toggleHighlight", op: "highlight" },
  { id: "editor:toggle-inline-code", nameKey: "cmd.toggleInlineCode", op: "inline-code" },
  { id: "editor:toggle-heading", nameKey: "cmd.toggleHeading", op: "heading" },
  // R186: Obsidian "Set heading 1".."6" / "Remove heading" (fixed-level, vs cycle)
  { id: "editor:set-heading-1", nameKey: "cmd.setHeading1", op: "heading-1" },
  { id: "editor:set-heading-2", nameKey: "cmd.setHeading2", op: "heading-2" },
  { id: "editor:set-heading-3", nameKey: "cmd.setHeading3", op: "heading-3" },
  { id: "editor:set-heading-4", nameKey: "cmd.setHeading4", op: "heading-4" },
  { id: "editor:set-heading-5", nameKey: "cmd.setHeading5", op: "heading-5" },
  { id: "editor:set-heading-6", nameKey: "cmd.setHeading6", op: "heading-6" },
  { id: "editor:remove-heading", nameKey: "cmd.removeHeading", op: "remove-heading" },
  { id: "editor:toggle-blockquote", nameKey: "cmd.toggleBlockquote", op: "blockquote" },
  { id: "editor:toggle-bullet-list", nameKey: "cmd.toggleBulletList", op: "bullet-list" },
  { id: "editor:toggle-numbered-list", nameKey: "cmd.toggleNumberedList", op: "numbered-list" },
  { id: "editor:toggle-checklist", nameKey: "cmd.toggleChecklist", op: "checklist" },
  // R40 toggle checkbox status (Cmd/Ctrl-L) — Obsidian-canonical default key
  { id: "editor:toggle-checkbox", nameKey: "cmd.toggleCheckbox", op: "toggle-task", hotkey: "Mod+L" },
  { id: "editor:toggle-code-block", nameKey: "cmd.toggleCodeBlock", op: "code-block" },
  { id: "editor:insert-callout", nameKey: "cmd.insertCallout", op: "callout" },
  // R198: Obsidian "Insert inline math" / "Insert math block" / "Insert
  // horizontal rule" — pure inserts (no default key, Obsidian "未设置")
  { id: "editor:insert-math", nameKey: "cmd.insertMath", op: "inline-math" },
  { id: "editor:insert-math-block", nameKey: "cmd.insertMathBlock", op: "math-block" },
  { id: "editor:insert-horizontal-rule", nameKey: "cmd.insertHorizontalRule", op: "horizontal-rule" },
];

/**
 * Register every R33 formatting command. `getView` returns the active-FILE
 * editor view or null (App passes `() => getActiveFileEditorView(app)?.view`);
 * when null the command is unavailable (palette hides it, hotkey skips it) and
 * the callback no-ops. Returns disposers for the registration effect cleanup.
 */
export function registerFormatCommands(
  app: GeodeApp,
  getView: () => EditorView | null,
): Array<() => void> {
  const disposers = FORMAT_COMMANDS.map((spec) =>
    app.commands.register({
      id: spec.id,
      name: () => t(spec.nameKey),
      hotkey: spec.hotkey,
      available: () => getView() !== null,
      callback: () => {
        const view = getView();
        if (!view) return;
        applyFormat(view, spec.op);
        view.focus();
      },
    }),
  );
  // R192: clear-formatting is syntax-tree based (not a pure FormatOp), so it is registered
  // here directly rather than via the op-dispatch path. No default key (Obsidian leaves it unset).
  disposers.push(
    app.commands.register({
      id: "editor:clear-formatting",
      name: () => t("cmd.clearFormatting"),
      available: () => getView() !== null,
      callback: () => {
        const view = getView();
        if (!view) return;
        clearFormatting(view);
        view.focus();
      },
    }),
  );
  // R199: insert-footnote is a two-site edit (ref `[^N]` at caret + def `[^N]: ` on
  // the last line) with bidirectional jump, so it is registered directly (not a
  // single-contiguous FormatOp). No default key (Obsidian leaves it unset).
  disposers.push(
    app.commands.register({
      id: "editor:insert-footnote",
      name: () => t("cmd.insertFootnote"),
      available: () => getView() !== null,
      callback: () => {
        const view = getView();
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const action = insertFootnote(view.state.doc.toString(), from, to);
        if (action.kind === "jump") {
          view.dispatch({ selection: { anchor: action.selTarget }, scrollIntoView: true });
        } else {
          view.dispatch({
            changes: action.changes,
            selection: { anchor: action.selTarget },
            scrollIntoView: true,
            userEvent: "input.insert.footnote",
          });
        }
        view.focus();
      },
    }),
  );
  return disposers;
}
