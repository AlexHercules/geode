import type { GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Page preview - hover-preview of internal links (Obsidian's "Page preview"
 * core plugin). R297: wired as a real builtin plugin per the R294 toggle
 * contract. Page preview has no panel/modal/command - it is a hover behavior
 * governed by the `pagePreviewEnabled`/`pagePreviewRequireModifier` stores. The
 * hover controller additionally gates on `isEnabled("page-preview")` so disabling
 * the plugin suppresses previews regardless of those settings. This plugin's
 * lifecycle is the toggle + its settings section; onload is intentionally empty.
 */
export const pagePreviewPlugin: GeodePlugin = {
  id: "page-preview",
  name: () => t("settings.pagePreviewHeading"),
  description: () => t("settings.pagePreviewDesc"),
  version: "1.0.0",
  onload() {
    /* toggle + settings-section plugin; the hover controller gates on isEnabled. */
  },
};
