import type { AppHandle, GeodePlugin } from "@core/plugins";
import { locale, t } from "@core/i18n";

const ITEM_ID = "word-count";

/** Disposer for the locale subscription (set in onload, released in onunload). */
let unsubscribeLocale: (() => void) | null = null;

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Word count — shows "N words · M chars" for the active note in the status bar.
 * Updates when the active file changes and when the active file is modified.
 */
export const wordCountPlugin: GeodePlugin = {
  id: "word-count",
  name: () => t("plugin.wordCount.name"),
  description: () => t("plugin.wordCount.desc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    // token guards against stale async reads overwriting a newer update
    let requestToken = 0;
    // whether the last render showed a selection ("N selected words"). Drives the
    // selection-transition gate (skip empty→empty caret moves) + the doc-edit
    // refresh (a same-transaction edit collapses the selection without firing
    // selection-changed, so a stale "N selected words" must be cleared).
    let showingSelection = false;

    const update = async () => {
      // bump at the TOP so EVERY entry (incl. the selected-words early-return)
      // invalidates an in-flight doc read — else a slow read could clobber the
      // selected-words display after the guard below.
      const token = ++requestToken;
      const path = app.workspace.getActiveFile();
      if (!path) {
        app.ui.removeStatusBarItem(ITEM_ID);
        showingSelection = false;
        return;
      }
      // R66: a non-empty selection in the active editor takes precedence —
      // Obsidian's word count shows "N selected words" while selecting. Read
      // straight from the active view (sync); no file read needed.
      const av = app.documents.getActiveView();
      if (av && av.path === path) {
        const sel = av.view.state.selection.main;
        if (!sel.empty) {
          app.ui.setStatusBarItem(
            ITEM_ID,
            t("plugin.wordCount.selected", {
              words: countWords(av.view.state.sliceDoc(sel.from, sel.to)),
            }),
          );
          showingSelection = true;
          return;
        }
      }
      showingSelection = false;
      let content = app.vault.readCached(path);
      if (content === undefined) {
        try {
          content = await app.vault.read(path);
        } catch {
          app.ui.removeStatusBarItem(ITEM_ID);
          return;
        }
        // a newer update started (or the active file changed) while we awaited
        if (token !== requestToken || path !== app.workspace.getActiveFile()) return;
      }
      app.ui.setStatusBarItem(
        ITEM_ID,
        t("plugin.wordCount", { words: countWords(content), chars: content.length }),
      );
    };

    // events.on via the plugin handle auto-tracks disposers
    app.events.on("active-file:changed", () => void update());
    app.events.on("file:modified", ({ path }) => {
      if (path === app.workspace.getActiveFile()) void update();
    });
    // R66: refresh on a selection-STATE TRANSITION only — a pure empty→empty caret
    // move must NOT re-count the whole doc + re-render the shell (hot path).
    app.events.on("document:selection-changed", ({ path }) => {
      if (path !== app.workspace.getActiveFile()) return;
      const av = app.documents.getActiveView();
      const nonEmpty = !!av && av.path === path && !av.view.state.selection.main.empty;
      if (nonEmpty || showingSelection) void update();
    });
    // R66: a doc edit can collapse a selection in the SAME transaction (no
    // selection-changed emit, only document:changed) — clear the stale selection
    // display once. Guarded by showingSelection so normal typing stays untouched.
    app.events.on("document:changed", ({ path }) => {
      if (showingSelection && path === app.workspace.getActiveFile()) void update();
    });

    // the status bar text is plain (re-rendered only on update) — refresh it on
    // locale switch so it does not keep the old language until the next edit
    unsubscribeLocale = locale.subscribe(() => void update());

    void update();
  },

  onunload() {
    // event listeners and the status bar item are disposed by the plugin
    // manager; the locale subscription is ours to release
    unsubscribeLocale?.();
    unsubscribeLocale = null;
  },
};
