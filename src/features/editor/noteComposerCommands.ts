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
import { headingSectionAt } from "@core/moveHeading";
import { basename, parentPath } from "@core/vault";

/**
 * Move the doc range [from, to) into a new note (named from its first line) and splice a
 * wikilink in its place. Shared by editor:extract-selection (range = selection) and
 * editor:move-heading (range = the section under the cursor). DATA SAFETY: create-before-
 * edit (the new note lands BEFORE the source is touched → a failed create loses nothing),
 * plus a stale-guard — the await yields the loop (desktop create is cross-process IPC), so
 * a concurrent edit could shift the captured offsets; re-verify the span still holds the
 * captured text before splicing, else keep the new note and skip the edit.
 */
async function extractRange(app: GeodeApp, view: EditorView, from: number, to: number): Promise<void> {
  const activePath = app.workspace.getActiveFile();
  if (!activePath) return;
  const content = view.state.doc.sliceString(from, to);
  if (content.trim().length === 0) return; // whitespace-only → don't make an empty note
  const folder = parentPath(activePath);
  const notePath = app.vault.uniquePath(folder, deriveNoteName(content));
  try {
    await app.vault.create(notePath, extractedContent(content));
  } catch (err) {
    console.error("[note-composer] extract failed to create note", err);
    return; // source untouched — no data loss
  }
  const doc = view.state.doc;
  if (to > doc.length || doc.sliceString(from, to) !== content) {
    console.warn("[note-composer] range changed during create — kept new note, skipped replace");
    return;
  }
  const finalName = basename(notePath).replace(/\.md$/i, "");
  const insert = extractReplacement(finalName, "link");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.extract",
  });
  view.focus();
}

async function extractSelection(app: GeodeApp, view: EditorView): Promise<void> {
  const main = view.state.selection.main;
  if (main.empty) return;
  await extractRange(app, view, main.from, main.to);
}

/** R216: move the section under the cursor (heading line + body, through the next
 *  same-or-higher heading) into a new note named from the heading. */
async function moveHeading(app: GeodeApp, view: EditorView): Promise<void> {
  const section = headingSectionAt(view.state.doc.toString(), view.state.selection.main.head);
  if (!section) return; // cursor not inside any heading section
  await extractRange(app, view, section.from, section.to);
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
    // R216 (G3 §12): "Move current heading to a new note". Always available with a view
    // (no-ops when the cursor is not in a heading section); range computed in moveHeading.
    app.commands.register({
      id: "editor:move-heading",
      name: () => t("cmd.moveHeading"),
      available: () => getView() !== null,
      callback: () => {
        const view = getView();
        if (!view) return;
        void moveHeading(app, view);
      },
    }),
  ];
}
