import type { AppHandle, GeodePlugin } from "@core/plugins";
import { locale, t } from "@core/i18n";

const ITEM_ID = "backlink-count";

/** Disposers for the manual subscriptions (set in onload, released in onunload). */
let unsubscribe: (() => void) | null = null;

/**
 * Backlink count (R66, ㉘ sibling) — shows "N backlinks" for the active note in
 * the status bar (Obsidian core shows this). N = total linked mentions (sum of
 * per-source contexts), matching the Backlinks pane's "Linked mentions" count.
 * Updates on active-file change and on any metadata change (a backlink can be
 * added/removed by editing ANOTHER note, so it tracks metadata.revision).
 */
export const backlinkCountPlugin: GeodePlugin = {
  id: "backlink-count",
  name: () => t("plugin.backlinkCount.name"),
  description: () => t("plugin.backlinkCount.desc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    const update = () => {
      const path = app.workspace.getActiveFile();
      if (!path) {
        app.ui.removeStatusBarItem(ITEM_ID);
        return;
      }
      const count = app.metadata
        .getBacklinks(path)
        .reduce((n, b) => n + b.contexts.length, 0);
      app.ui.setStatusBarItem(ITEM_ID, t("plugin.backlinkCount", { count }));
    };

    // events.on via the plugin handle auto-tracks disposers
    app.events.on("active-file:changed", update);
    // a backlink changes when any note's links change → re-derive on revision.
    // Store.subscribe does not fire immediately, so call update() once below.
    const unsubRevision = app.metadata.revision.subscribe(update);
    const unsubLocale = locale.subscribe(update);
    unsubscribe = () => {
      unsubRevision();
      unsubLocale();
    };

    update();
  },

  onunload() {
    // event listeners and the status bar item are disposed by the plugin
    // manager; the Store subscriptions are ours to release
    unsubscribe?.();
    unsubscribe = null;
  },
};
