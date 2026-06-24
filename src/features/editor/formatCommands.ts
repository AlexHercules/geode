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
import { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { applyFormatOp, type FormatOp } from "@core/format";
import { t, type I18nKey } from "@core/i18n";

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
  return FORMAT_COMMANDS.map((spec) =>
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
}
