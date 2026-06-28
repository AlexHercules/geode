/**
 * R131 (file-menu 大头 phase 2) + R200: an always-on CM6 extension that turns an editor right-click
 * into a real context menu — native Cut / Copy / Paste plus the Obsidian `workspace.on('editor-menu')`
 * event so plugins can `menu.addItem(...)`. R131 built the event + compat Menu but left the menu empty
 * of native items (deferred), only replacing the browser menu when a plugin contributed one. R200 adds
 * the native clipboard items and always shows the menu. Registered into the core editorExtensions
 * registry (R115) from context.ts, so it applies to every editor without the editor feature importing
 * compat.
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { t } from "@core/i18n";
import { getCommandName, type CommandRegistry } from "@core/commands";
import type { Command } from "@core/types";
import { Menu } from "./ui";
import type { Workspace } from "./workspace";

/**
 * Add the native Cut / Copy / Paste items, operating on `view` via CM dispatch (undo-safe) + the async
 * clipboard API. Cut deletes ONLY after a successful copy, so a clipboard failure can never lose the
 * selection (底线①). All three read the live selection at click time — the menu blocks editor
 * interaction, so the selection (and thus the offsets) are unchanged and in-bounds.
 */
function addClipboardItems(menu: Menu, view: EditorView): void {
  const hasSelection = !view.state.selection.main.empty;
  menu.addItem((item) =>
    item
      .setTitle(t("editorMenu.cut"))
      .setIcon("scissors")
      .setDisabled(!hasSelection)
      .onClick(() => {
        const sel = view.state.selection.main;
        if (sel.empty) return;
        const copied = view.state.sliceDoc(sel.from, sel.to);
        void navigator.clipboard
          .writeText(copied)
          .then(() => {
            // re-validate the range still holds exactly what we copied — a doc reload
            // could shift bytes during the await; delete only the copied text, else skip
            // (the clipboard already holds it, so nothing is lost).
            if (view.state.sliceDoc(sel.from, sel.to) !== copied) return;
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: "" },
              userEvent: "delete.cut",
              scrollIntoView: true,
            });
            view.focus();
          })
          .catch(() => {
            /* clipboard denied/headless — do NOT delete (would lose the text with no copy) */
          });
      }),
  );
  menu.addItem((item) =>
    item
      .setTitle(t("editorMenu.copy"))
      .setIcon("copy")
      .setDisabled(!hasSelection)
      .onClick(() => {
        const sel = view.state.selection.main;
        if (sel.empty) return;
        void navigator.clipboard.writeText(view.state.sliceDoc(sel.from, sel.to)).catch(() => {});
        view.focus();
      }),
  );
  menu.addItem((item) =>
    item.setTitle(t("editorMenu.paste")).setIcon("clipboard").onClick(() => {
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (!text) return;
          const sel = view.state.selection.main;
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length },
            userEvent: "input.paste",
            scrollIntoView: true,
          });
          view.focus();
        })
        .catch(() => {
          /* clipboard read denied/empty — no-op */
        });
    }),
  );
}

/**
 * R252: the editor right-click file-action items (reference 08), grouped with separators. Each item
 * is pure wiring to an EXISTING vetted command via `commands.execute(id)` — the command reads
 * `workspace.getActiveFile()` itself, so no path is threaded. Labels reuse `getCommandName` (the
 * bookmark item's name auto-flips bookmark/unbookmark). Delete routes to the vetted `app:delete-file`
 * (deleteConfirm + flush + recoverable trash + R244 orphan handling) — never a new delete path (底线①);
 * rename routes to `workspace:edit-file-title` (R16 link rewrite). Desktop-only items (reveal/open in
 * default app) carry `available: () => isTauri() && …`, so the per-command `available()` gate below
 * hides them in the browser — necessary because `commands.execute()` does NOT check `available()`.
 * A separator is added only before a NON-EMPTY group, so hiding the desktop group leaves no dangling rule.
 */
const FILE_ACTION_GROUPS: string[][] = [
  ["bookmarks:bookmark-file", "editor:add-property", "app:export-pdf", "file-explorer:copy-path", "workspace:copy-url"],
  ["file-explorer:reveal-in-system", "file-explorer:open-in-default-app"],
  ["workspace:edit-file-title", "app:delete-file"],
];

/**
 * R269: one leading icon per file-action item (reference 08 — Obsidian's menu items are iconed).
 * Names resolve in the compat icon registry (`icons.ts` BUILTIN); the gutter is already 16px wide
 * (no `setNoIcon()`), so each entry just fills the existing blank column. Pure presentation.
 */
const ICON_BY_COMMAND: Record<string, string> = {
  "bookmarks:bookmark-file": "bookmark",
  "editor:add-property": "plus",
  "app:export-pdf": "file-output",
  "file-explorer:copy-path": "copy",
  "workspace:copy-url": "link",
  "file-explorer:reveal-in-system": "folder",
  "file-explorer:open-in-default-app": "external-link",
  "workspace:edit-file-title": "pencil",
  "app:delete-file": "trash",
};

function addFileActionItems(menu: Menu, commands: CommandRegistry): void {
  const byId = new Map(commands.list().map((c) => [c.id, c]));
  for (const group of FILE_ACTION_GROUPS) {
    const cmds = group
      .map((id) => byId.get(id))
      .filter((c): c is Command => !!c && c.available?.() !== false);
    if (cmds.length === 0) continue;
    menu.addSeparator();
    for (const cmd of cmds) {
      menu.addItem((item) => {
        item.setTitle(getCommandName(cmd)).onClick(() => void commands.execute(cmd.id));
        const icon = ICON_BY_COMMAND[cmd.id];
        if (icon) item.setIcon(icon);
        if (cmd.id === "app:delete-file") item.setWarning(true);
      });
    }
  }
}

export function editorContextMenuExtension(workspace: Workspace, commands: CommandRegistry): Extension {
  return EditorView.domEventHandlers({
    contextmenu(evt, view) {
      const info = workspace.activeEditor;
      if (!info) return false; // no active markdown editor → let the browser menu through
      const menu = new Menu();
      addClipboardItems(menu, view);
      addFileActionItems(menu, commands);
      const nativeCount = menu.dom.childElementCount; // native clipboard + file-action items + separators
      workspace.trigger("editor-menu", menu, info.editor, info);
      // place ONE rule between the native items and plugin-contributed items, only when a
      // plugin actually added a non-separator node (avoids a dangling or doubled rule)
      const firstPlugin = menu.dom.children.item(nativeCount);
      if (firstPlugin && !firstPlugin.classList.contains("menu-separator")) {
        const sep = document.createElement("div");
        sep.className = "menu-separator";
        menu.dom.insertBefore(sep, firstPlugin);
      }
      // drop any trailing separator a plugin may have left dangling at the bottom
      for (let tail = menu.dom.lastElementChild; tail?.classList.contains("menu-separator"); ) {
        const prev = tail.previousElementSibling;
        tail.remove();
        tail = prev;
      }
      evt.preventDefault();
      menu.showAtMouseEvent(evt);
      return true;
    },
  });
}
