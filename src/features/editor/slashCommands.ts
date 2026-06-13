/**
 * Slash-command menu (R31) — typing `/` at line start or after whitespace opens
 * a command picker in the editor, filtered as you type; Enter/click runs the
 * command and deletes the `/query` text.
 *
 * Layering: the R6 EditorSuggest pipeline lives in compat/ (features must never
 * import compat), so this mirrors the NATIVE CM6 `@codemirror/autocomplete`
 * path that powers `[[` wikilink completion (cmExtensions.ts) — a completion
 * source appended to the autocompletion `override` array. See ARCHITECTURE.md
 * "Round 31 additions".
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { GeodeApp } from "@app/AppContext";
import { getCommandName } from "@core/commands";
import { fuzzyMatch } from "@core/fuzzy";
import type { Command } from "@core/types";

/** Shared trigger regex: `/` + command-name chars, at line start or after
 *  whitespace. The `(^|\s)` gate keeps `and/or`, `http://`, `[[a/b]]` from
 *  ever firing the menu. */
export const SLASH_RE = /(^|\s)(\/[\w-]*)$/;

/** Pure trigger test (shared by the source and the desktop probe): the line
 *  text from line-start up to the cursor → the query (without the leading `/`)
 *  or null when `/` is not in a trigger position. Suppressed inside an open
 *  `[[` wikilink (an unclosed `[[` after the last `]]`) — that context belongs
 *  to the wikilink completion, which would otherwise co-fire on `[[foo /bar`. */
export function slashTrigger(before: string): { query: string } | null {
  const m = SLASH_RE.exec(before);
  if (!m) return null;
  if (before.lastIndexOf("[[") > before.lastIndexOf("]]")) return null;
  return { query: m[2].slice(1) };
}

/** Candidate commands for a slash query: every available command, fuzzy-ranked
 *  by name (descending); empty query → registry order (already name-sorted).
 *  Shared by the source and the probe so ranking is identical. */
export function slashCandidates(app: GeodeApp, query: string): Command[] {
  const available = app.commands.list().filter((c) => c.available?.() !== false);
  if (query === "") return available;
  const ranked: Array<{ cmd: Command; score: number }> = [];
  for (const cmd of available) {
    const m = fuzzyMatch(query, getCommandName(cmd));
    if (m) ranked.push({ cmd, score: m.score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((r) => r.cmd);
}

/** CM6 completion source — append to the autocompletion `override` array. */
export function slashCommandSource(app: GeodeApp) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.sliceDoc(line.from, ctx.pos);
    const hit = slashTrigger(before); // gate + wikilink guard, shared with probe
    if (hit === null) return null;
    const from = ctx.pos - hit.query.length - 1; // offset of the `/`
    const cmds = slashCandidates(app, hit.query);
    if (cmds.length === 0) return null;
    const options: Completion[] = cmds.map((cmd) => ({
      label: getCommandName(cmd),
      // two transactions: delete `/query` (cursor falls back to the `/`), then
      // run the command so its insertion/side-effect lands there. Both are CM
      // dispatches → autosave covers them; no new vault write path.
      apply: (view, _completion, applyFrom, applyTo) => {
        view.dispatch({ changes: { from: applyFrom, to: applyTo, insert: "" } });
        app.commands.execute(cmd.id);
      },
    }));
    // filter:false — we pre-rank with fuzzyMatch (same order as the palette).
    // NO validFor: CM6 reuses (and stops re-querying) a result while validFor
    // matches, which with filter:false would FREEZE the list as you type. Omit
    // it so CM re-runs this source on every keystroke → live re-rank/narrow.
    return { from, options, filter: false };
  };
}
