/**
 * R51 line-motion editor commands (#⑳) — move/copy the current line(s) up/down,
 * thin command-layer wrappers over @codemirror/commands. Mirrors formatCommands'
 * getView-injection pattern: App injects `() => getActiveFileEditorView(app)?.view`.
 *
 * Keys go through cmExtensions' Prec.highest `app.commands.handleKeydown` interceptor,
 * which runs BEFORE CM's keymaps. CM's own defaultKeymap already binds Alt-Arrow→move /
 * Shift-Alt-Arrow→copy (the universal editor convention shared by CodeMirror, VS Code,
 * Sublime, and Obsidian's CM6 editor). We bind the *named* commands to the SAME keys:
 * the interceptor matches first, runs the command, preventDefault+stopPropagation+returns
 * true, so defaultKeymap never re-fires — single trigger, no redundancy, and the keys are
 * now palette-discoverable + user-rebindable instead of hard-wired in defaultKeymap.
 * (Mod+Shift+Arrow was avoided: on macOS it shadows the native select-to-doc-edge.)
 *
 * No new write path: the line-motion commands are a single CM transaction (dirty →
 * autosave); the R191 add-cursor commands change ONLY the selection (no doc change).
 */
import { copyLineDown, copyLineUp, moveLineDown, moveLineUp } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { t, type I18nKey } from "@core/i18n";

/**
 * R191: add a collapsed cursor one line above/below the main cursor (Obsidian
 * editor:add-cursor-above / -below). view.moveVertically respects the goal column,
 * wrapped lines, and tab widths. No-op at the doc edge (the move stays on the same
 * line) or when a cursor already sits there. Selection-only — no document change.
 */
function addCursorVertical(view: EditorView, forward: boolean): boolean {
  const { state } = view;
  const main = state.selection.main;
  const moved = view.moveVertically(EditorSelection.cursor(main.head), forward);
  if (state.doc.lineAt(moved.head).number === state.doc.lineAt(main.head).number) return false;
  if (state.selection.ranges.some((r) => r.empty && r.head === moved.head)) return false;
  const ranges = [...state.selection.ranges, EditorSelection.cursor(moved.head)];
  // new cursor becomes main → repeated presses cascade further in the same direction
  view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1), scrollIntoView: true });
  return true;
}

interface MotionSpec {
  id: string;
  nameKey: I18nKey;
  cmd: (view: EditorView) => boolean;
  hotkey?: string;
}

const MOTION_COMMANDS: ReadonlyArray<MotionSpec> = [
  { id: "editor:move-line-up", nameKey: "cmd.moveLineUp", cmd: moveLineUp, hotkey: "Alt+ArrowUp" },
  { id: "editor:move-line-down", nameKey: "cmd.moveLineDown", cmd: moveLineDown, hotkey: "Alt+ArrowDown" },
  { id: "editor:copy-line-up", nameKey: "cmd.copyLineUp", cmd: copyLineUp, hotkey: "Shift+Alt+ArrowUp" },
  { id: "editor:copy-line-down", nameKey: "cmd.copyLineDown", cmd: copyLineDown, hotkey: "Shift+Alt+ArrowDown" },
  // R191: multi-cursor (no default key — Obsidian leaves these unbound)
  { id: "editor:add-cursor-above", nameKey: "cmd.addCursorAbove", cmd: (v) => addCursorVertical(v, false) },
  { id: "editor:add-cursor-below", nameKey: "cmd.addCursorBelow", cmd: (v) => addCursorVertical(v, true) },
];

/**
 * Register the line-motion commands. `getView` returns the active-FILE editor view
 * or null; when null the command is unavailable (palette hides it, hotkey skips it)
 * and the callback no-ops. Returns disposers for the registration effect cleanup.
 */
export function registerEditorMotionCommands(
  app: GeodeApp,
  getView: () => EditorView | null,
): Array<() => void> {
  return MOTION_COMMANDS.map((spec) =>
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
