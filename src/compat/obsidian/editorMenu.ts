/**
 * R131 (file-menu 大头 phase 2): an always-on CM6 extension that turns an editor right-click into
 * the Obsidian `workspace.on('editor-menu')` event. Geode's editor has no native context menu (it
 * uses the browser default), so on contextmenu we build a real compat Menu, fire 'editor-menu' (so
 * plugins `menu.addItem(...)`), and — IF a plugin contributed an item — preventDefault + show the
 * Menu; otherwise we let the browser's default menu through unchanged. Registered into the core
 * editorExtensions registry (R115) from context.ts, so it applies to every editor without the editor
 * feature importing compat. v1 = plugin items only (no native cut/copy/paste in the menu — deferred).
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Menu } from "./ui";
import type { Workspace } from "./workspace";

export function editorContextMenuExtension(workspace: Workspace): Extension {
  return EditorView.domEventHandlers({
    contextmenu(evt) {
      const info = workspace.activeEditor;
      if (!info) return false; // no active markdown editor → let the browser menu through
      const menu = new Menu();
      workspace.trigger("editor-menu", menu, info.editor, info);
      // only replace the browser menu when a plugin actually contributed an item
      if (!menu.dom.querySelector(".menu-item")) return false;
      evt.preventDefault();
      menu.showAtMouseEvent(evt);
      return true;
    },
  });
}
