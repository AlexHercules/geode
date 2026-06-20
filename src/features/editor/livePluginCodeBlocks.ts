/**
 * R134 live-preview plugin code blocks — render PLUGIN-registered ```<lang> fences (Dataview's
 * `dataview` block, Tasks' `tasks` block) as live widgets in the editor, not just the reading view.
 * Reuses the shared cursor-aware block-widget machinery (./liveBlockWidget, R55) like liveMermaid /
 * liveMath / liveQuery do — a fence the selection is NOT inside is REPLACED by a non-editable widget
 * that runs the registered handler; cursor/click into the fence reveals the source. The lang→handler
 * lookup comes from the core registry (R134, written by Plugin.registerMarkdownCodeBlockProcessor),
 * so a fence only becomes a widget when a plugin has registered its language. Pure view — the
 * document is never modified.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension } from "@codemirror/state";
import type { GeodeApp } from "@app/AppContext";
import { hasCodeBlockProcessor } from "@core/markdownPostProcessors";
import { liveBlockWidgets } from "./liveBlockWidget";
import { PluginCodeBlockWidget } from "./liveHydratedWidget";

/** Fence langs that already have a dedicated built-in live-block extension (liveMermaid/liveQuery).
 *  A plugin registering one of these must NOT also be rendered here — both detectors would emit a
 *  block-replace decoration over the same range (CM conflict). Built-in wins, mirroring the reading
 *  view where mermaid/query render as `.geode-*` divs and never match a plugin's `language-*` (R134
 *  review). (liveMath is `$$`, liveTables is pipe tables — neither is a fenced lang.) */
const BUILTIN_LIVE_FENCE_LANGS = new Set(["mermaid", "query"]);

/** Fence ranges in `state` whose info-string lang has a registered code-block processor (pure — also
 *  drives the desktop probe). Mirrors liveQuery/liveMermaid's detector: the lang is the first
 *  whitespace word of CodeInfo (case-sensitive), gated by `hasCodeBlockProcessor`. */
export function findPluginCodeBlockRanges(state: EditorState): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode") {
        const info = node.node.getChild("CodeInfo");
        const lang = info ? state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0] : "";
        if (lang && !BUILTIN_LIVE_FENCE_LANGS.has(lang) && hasCodeBlockProcessor(lang)) {
          out.push({ from: node.from, to: node.to });
        }
        return false; // don't descend into the fence body
      }
      return undefined;
    },
  });
  return out;
}

/** The live plugin-code-block extension. `getPath` = the current note (handler ctx). */
export function livePluginCodeBlocks(app: GeodeApp, getPath: () => string): Extension {
  return liveBlockWidgets({
    ranges: findPluginCodeBlockRanges,
    widget: (source, from) => new PluginCodeBlockWidget(source, from, app, getPath),
  });
}
