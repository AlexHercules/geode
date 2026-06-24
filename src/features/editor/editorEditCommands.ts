/**
 * R52 editor editing commands (#⑳余项延续) — toggle-comment / indent / unindent /
 * insert-blank-line / select-line, thin command-layer wrappers over the
 * @codemirror/commands StateCommands. Same template as R51 editorMotionCommands:
 * App injects `() => getActiveFileEditorView(app)?.view`, name is a thunk, the
 * command is unavailable (palette hides + hotkey skips + callback no-op) when no
 * active-FILE editor view exists, and every command is a single CM transaction
 * (dirty → autosave) — no new vault write path.
 *
 * `toggle-comment` produces Obsidian's `%%…%%` comment: markdown has no comment
 * tokens of its own, so cmExtensions adds `markdownLanguage.data.of({ commentTokens:
 * { block: { open: "%%", close: "%%" } } })`; toggleComment falls through to the
 * block-comment path and wraps/unwraps the selection (or current line) in `%%`.
 * Mod+/ is the only default key (the universal comment-toggle convention; it is
 * free in Geode's hotkey table). indent/unindent carry no default key — Tab /
 * Shift-Tab already indent via defaultKeymap's indentWithTab; these add the named,
 * palette-discoverable + rebindable commands (Obsidian "Indent" / "Unindent").
 */
import { indentLess, indentMore, insertBlankLine, selectLine, toggleComment } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { t, type I18nKey } from "@core/i18n";
import { commentSpans } from "./formatCommands";

const FENCE_RE = /^(`{3,}|~{3,})/;

/** End offset of the YAML frontmatter block (after the closing `---`/`...` line), or 0 when
 *  there is none. Used so delete-paragraph never deletes inside the block. */
function frontmatterEnd(doc: Text): number {
  if (doc.lines < 1 || doc.line(1).text !== "---") return 0;
  for (let i = 2; i <= doc.lines; i++) {
    const lt = doc.line(i).text;
    if (lt === "---" || lt === "...") return doc.line(i).to;
  }
  return 0; // unterminated → treat as no frontmatter
}

/** Block-math (`$$…$$`) ranges with indent ≤ 3 — mirrors core/markdown.ts's geode-math-block
 *  rule (the reading-view authority). NOT liveMath's findMathBlockRanges, which requires
 *  indent === 0 for the live widget: an indent-1..3 `$$` block still renders as math in the
 *  reading view, so delete-paragraph must treat it as one block too (R192 overlay lesson). */
function blockMathRanges(doc: Text): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);
    const indent = line.text.length - line.text.trimStart().length;
    const trimmed = line.text.trim();
    if (indent > 3 || !trimmed.startsWith("$$")) { i++; continue; }
    const rest = trimmed.slice(2).trimEnd();
    const innerClose = rest.indexOf("$$");
    if (innerClose >= 0 && innerClose !== rest.length - 2) { i++; continue; } // `$$x$$ foo` → not a block
    let end = -1;
    if (rest.endsWith("$$")) {
      end = i; // single-line `$$x$$`
    } else {
      for (let ln = i + 1; ln <= doc.lines; ln++) {
        const lt = doc.line(ln).text;
        if (lt.length - lt.trimStart().length <= 3 && FENCE_RE.test(lt.trim())) break; // bail at a fence
        if (lt.trimEnd().endsWith("$$")) { end = ln; break; }
      }
    }
    if (end < 0) { i++; continue; } // unterminated → literal
    out.push({ from: line.from, to: doc.line(end).to });
    i = end + 1;
  }
  return out;
}

/**
 * R197: delete the paragraph (top-level block) at the cursor (Obsidian
 * editor:delete-paragraph). Uses the syntax tree so a whole block is removed — never a
 * line-based slice that could split a fenced code block. No-ops inside the frontmatter
 * (use clear-metadata-properties) or in a blank gap between blocks. Removes the block plus
 * its trailing newline(s) so the next block moves up.
 *
 * R192-lesson guards (review-found): a multi-line Geode overlay (block math indent≤3 /
 * `%%comment%%`) that Lezer splits at a blank line is deleted WHOLE — by INTERSECTION (not
 * cursor membership: the caret may sit in surrounding text that straddles the overlay), to
 * a fixpoint. And `from` is snapped to the line start so an indented code block does not
 * strand its leading whitespace.
 */
function deleteParagraph(view: EditorView): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  if (pos < frontmatterEnd(state.doc)) return false;
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node.parent && node.parent.name !== "Document") node = node.parent;
  // a caret at the end of a block's last line resolves (side=+1) into the inter-block gap —
  // retry biased to the preceding block (unless the char before is a newline = a real gap).
  if (node.name === "Document" && pos > 0 && state.doc.sliceString(pos - 1, pos) !== "\n") {
    node = syntaxTree(state).resolveInner(pos, -1);
    while (node.parent && node.parent.name !== "Document") node = node.parent;
  }
  if (node.name === "Document") return false; // a blank gap between blocks → nothing to delete
  let from = node.from;
  let to = node.to;
  // expand over any overlay the block intersects but Lezer split (extends past the block).
  // pairedOnly: an UNPAIRED `%%` opener (half-written comment) has no closer to orphan, so
  // it must not drag the deletion to EOF — only closed `%%…%%` spans need the expansion.
  const overlays = [...blockMathRanges(state.doc), ...commentSpans(state, true)];
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of overlays) {
      if (r.from < to && r.to > from && (r.from < from || r.to > to)) {
        from = Math.min(from, r.from);
        to = Math.max(to, r.to);
        changed = true;
      }
    }
  }
  from = state.doc.lineAt(from).from; // snap to line start (indented code keeps its indent)
  while (to < state.doc.length && state.doc.sliceString(to, to + 1) === "\n") to += 1;
  view.dispatch({ changes: { from, to, insert: "" }, userEvent: "delete", scrollIntoView: true });
  return true;
}

interface EditSpec {
  id: string;
  nameKey: I18nKey;
  cmd: (view: EditorView) => boolean;
  hotkey?: string;
}

const EDIT_COMMANDS: ReadonlyArray<EditSpec> = [
  { id: "editor:toggle-comment", nameKey: "cmd.toggleComment", cmd: toggleComment, hotkey: "Mod+/" },
  { id: "editor:indent", nameKey: "cmd.indent", cmd: indentMore },
  { id: "editor:unindent", nameKey: "cmd.unindent", cmd: indentLess },
  { id: "editor:insert-blank-line", nameKey: "cmd.insertBlankLine", cmd: insertBlankLine },
  { id: "editor:select-line", nameKey: "cmd.selectLine", cmd: selectLine },
  // R197: Obsidian editor:delete-paragraph (no default key) — syntax-tree block delete
  { id: "editor:delete-paragraph", nameKey: "cmd.deleteParagraph", cmd: deleteParagraph },
];

/**
 * Register the editing commands. `getView` returns the active-FILE editor view or
 * null; when null the command is unavailable and the callback no-ops. Returns
 * disposers for the registration effect cleanup.
 */
export function registerEditorEditCommands(
  app: GeodeApp,
  getView: () => EditorView | null,
): Array<() => void> {
  return EDIT_COMMANDS.map((spec) =>
    app.commands.register({
      id: spec.id,
      name: () => t(spec.nameKey),
      hotkey: spec.hotkey,
      available: () => getView() !== null,
      callback: () => {
        const view = getView();
        if (!view) return;
        spec.cmd(view);
        view.focus();
      },
    }),
  );
}
