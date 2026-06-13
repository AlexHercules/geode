/**
 * R44 Note composer — "extract current selection → new note" command. Bridges
 * the pure core (core/noteComposer.ts) to a live EditorView, mirroring
 * formatCommands' getView-injection pattern.
 *
 * Layering: features/editor may import core + app/AppContext. Writes go through
 * the normal CM transaction → documents dirty → autosave pipeline (no new write
 * path; inherits B-class guards). getView resolves the ACTIVE-FILE view only, so
 * the command can never edit a background/non-active file (R23 DS).
 *
 * DATA SAFETY — create-before-edit: the new note (atomic R43 vault.create) is
 * persisted BEFORE the source selection is removed, so a failed create leaves the
 * source untouched and never loses the extracted text. No cross-file link rewrite
 * (the new note has no inbound links → R16 engine not needed).
 */
import { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { t } from "@core/i18n";
import { deriveNoteName, extractedContent, extractReplacement } from "@core/noteComposer";
import { basename, parentPath } from "@core/vault";

async function extractSelection(app: GeodeApp, view: EditorView): Promise<void> {
  const main = view.state.selection.main;
  if (main.empty) return;
  const activePath = app.workspace.getActiveFile();
  if (!activePath) return;
  const selected = view.state.doc.sliceString(main.from, main.to);
  if (selected.trim().length === 0) return; // whitespace-only → don't make an empty note
  const folder = parentPath(activePath);
  const notePath = app.vault.uniquePath(folder, deriveNoteName(selected));
  try {
    await app.vault.create(notePath, extractedContent(selected));
  } catch (err) {
    console.error("[note-composer] extract failed to create note", err);
    return; // source untouched — no data loss
  }
  // The await above yields the event loop (on desktop vault.create is a cross-
  // process IPC); a user/IME edit landing in that window would make the captured
  // main.from/to STALE → splicing them blindly would delete the wrong span (data
  // loss) or throw RangeError if out of bounds. Optimistic guard (R16 splice-
  // verification spirit): only replace when the captured span is still intact.
  // Otherwise keep the new note (harmless duplicate of the text) and skip the edit.
  const doc = view.state.doc;
  if (main.to > doc.length || doc.sliceString(main.from, main.to) !== selected) {
    console.warn("[note-composer] selection changed during create — kept new note, skipped replace");
    return;
  }
  const finalName = basename(notePath).replace(/\.md$/i, "");
  const insert = extractReplacement(finalName, "link");
  view.dispatch({
    changes: { from: main.from, to: main.to, insert },
    selection: { anchor: main.from + insert.length },
    userEvent: "input.extract",
  });
  view.focus();
}

/**
 * Register the extract-selection command. `getView` returns the active-FILE
 * editor view or null (App passes `() => getActiveFileEditorView(app)?.view`);
 * unavailable when there's no view or the selection is empty. Returns disposers.
 */
export function registerComposerCommands(
  app: GeodeApp,
  getView: () => EditorView | null,
): Array<() => void> {
  return [
    app.commands.register({
      id: "editor:extract-selection",
      name: () => t("cmd.extractSelection"),
      available: () => {
        const v = getView();
        return v !== null && !v.state.selection.main.empty;
      },
      callback: () => {
        const view = getView();
        if (!view) return;
        void extractSelection(app, view);
      },
    }),
  ];
}
