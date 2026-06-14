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
import type { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { t, type I18nKey } from "@core/i18n";

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
