import type { GeodePlugin } from "@core/plugins";
import { backlinkCountPlugin } from "./backlink-count";
import { backlinksPlugin } from "./backlinks";
import { commandPalettePlugin } from "./command-palette";
import { dailyNotePlugin } from "./daily-note";
import { fileExplorerPlugin } from "./file-explorer";
import { graphPlugin } from "./graph";
import { outlinePlugin } from "./outline";
import { outgoingLinksPlugin } from "./outgoing-links";
import { quickSwitcherPlugin } from "./quick-switcher";
import { randomNotePlugin } from "./random-note";
import { searchPlugin } from "./search";
import { tagsPlugin } from "./tags";
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
];
