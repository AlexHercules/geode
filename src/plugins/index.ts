import type { GeodePlugin } from "@core/plugins";
import { dailyNotePlugin } from "./daily-note";
import { randomNotePlugin } from "./random-note";
import { uniqueNotePlugin } from "./unique-note";
import { wordCountPlugin } from "./word-count";

/**
 * Built-in plugins, compiled into the app and registered at startup.
 * External scripts can register more at runtime via window.geode.registerPlugin.
 */
export const BUILTIN_PLUGINS: GeodePlugin[] = [
  wordCountPlugin,
  dailyNotePlugin,
  randomNotePlugin,
  uniqueNotePlugin,
];
