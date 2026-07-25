import type { GeodePlugin } from "@core/plugins";
import { backlinkCountPlugin } from "./backlink-count";
import { backlinksPlugin } from "./backlinks";
import { bookmarksPlugin } from "./bookmarks";
import { commandPalettePlugin } from "./command-palette";
import { dailyNotePlugin } from "./daily-note";
import { fileExplorerPlugin } from "./file-explorer";
import { fileRecoveryPlugin } from "./file-recovery";
import { footnotesViewPlugin } from "./footnotes-view";
import { graphPlugin } from "./graph";
import { noteComposerPlugin } from "./note-composer";
import { outlinePlugin } from "./outline";
import { outgoingLinksPlugin } from "./outgoing-links";
import { pagePreviewPlugin } from "./page-preview";
import { propertiesViewPlugin } from "./properties-view";
import { quickSwitcherPlugin } from "./quick-switcher";
import { randomNotePlugin } from "./random-note";
import { searchPlugin } from "./search";
import { tagsPlugin } from "./tags";
import { templatesPlugin } from "./templates";
import { uniqueNotePlugin } from "./unique-note";
import { wordCountPlugin } from "./word-count";
import { workspacesPlugin } from "./workspaces";

/**
 * Built-in plugins, compiled into the app and registered at startup.
 * External plugins can register more at runtime via window.geode.registerPlugin.
 */
export const BUILTIN_PLUGINS: GeodePlugin[] = [
  wordCountPlugin,
  backlinkCountPlugin,
  dailyNotePlugin,
  randomNotePlugin,
  tagsPlugin,
  uniqueNotePlugin,
  // R295 wave-1 sidebar knowledge views (real core-plugin toggles per R294 contract)
  outlinePlugin,
  outgoingLinksPlugin,
  backlinksPlugin,
  graphPlugin,
  // R296 wave-2 workspace + discovery entries
  fileExplorerPlugin,
  searchPlugin,
  quickSwitcherPlugin,
  commandPalettePlugin,
  workspacesPlugin,
  // R297 wave-3 content services + settings-Tab gate
  templatesPlugin,
  fileRecoveryPlugin,
  noteComposerPlugin,
  pagePreviewPlugin,
  bookmarksPlugin,
  propertiesViewPlugin,
  footnotesViewPlugin,
];
