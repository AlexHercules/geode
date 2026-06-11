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
  name: "Word count",
  description: "Shows word and character counts for the active note in the status bar.",
  version: "1.0.0",

  onload(app: AppHandle) {
    // token guards against stale async reads overwriting a newer update
    let requestToken = 0;

    const update = async () => {
      const path = app.workspace.getActiveFile();
      if (!path) {
        app.ui.removeStatusBarItem(ITEM_ID);
        return;
      }
      const token = ++requestToken;
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
