import type { GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Note composer - merge notes, or move note content into another note (Obsidian's
 * "Note composer" core plugin). R297: wired as a real builtin plugin per the R294
 * toggle contract. Note composer has no panel/modal of its own - it is a set of
 * editor action commands (extract-selection / move-heading / merge-file) that
 * live in noteComposerCommands.ts + App.tsx. Those actions gate on
 * `isEnabled("note-composer")` via their `available()` (hidden from the palette
 * + hotkeys when disabled). This plugin's lifecycle is the toggle + its settings
 * section; onload is intentionally empty.
 */
export const noteComposerPlugin: GeodePlugin = {
  id: "note-composer",
  name: () => t("settings.section.noteComposer"),
  description: () => t("settings.corePlugin.noteComposerDesc"),
  version: "1.0.0",
  onload() {
    /* toggle + settings-section plugin; action commands are availability-gated. */
  },
};
