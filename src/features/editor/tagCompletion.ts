/**
 * Editor `#` tag completion (R41) — typing `#` + tag chars (at line start or after
 * whitespace) suggests existing vault tags; accept inserts `#fulltag`. Mirrors the
 * native CM6 path used by slashCommands / `[[` wikilink completion (features must
 * never import compat). Contract: docs/ARCHITECTURE.md "Round 41 additions".
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { GeodeApp } from "@app/AppContext";
import { fuzzyMatch } from "@core/fuzzy";

/** `#` + tag chars, at line start / after whitespace / after `(` — same leading
 *  gate as metadata's TAG_RE (R41 review: `(#tag` is indexed, so completion must
 *  trigger there too). A single `#` only — `##` / `# ` (headings) don't match. */
export const TAG_RE = /(^|[\s(])(#[A-Za-z0-9_\/\-一-鿿]*)$/;

/** Pure trigger test (shared by the source + the __geodeTag probe). Suppressed
 *  inside an open `[[` wikilink (belongs to wikilink completion). */
export function tagTrigger(before: string): { query: string } | null {
  const m = TAG_RE.exec(before);
  if (!m) return null;
  if (before.lastIndexOf("[[") > before.lastIndexOf("]]")) return null;
  return { query: m[2].slice(1) }; // drop the leading '#'
}

/** Candidate tags for a query: empty → all tags sorted alpha; else fuzzy-ranked. */
export function tagCandidates(tags: string[], query: string): string[] {
  if (query === "") return [...tags].sort((a, b) => a.localeCompare(b));
  const ranked: Array<{ tag: string; score: number }> = [];
  for (const tag of tags) {
    const m = fuzzyMatch(query, tag);
    if (m) ranked.push({ tag, score: m.score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((r) => r.tag);
}

/** CM6 completion source — append to the autocompletion `override` array. */
export function tagCompletionSource(app: GeodeApp) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.sliceDoc(line.from, ctx.pos);
    const hit = tagTrigger(before);
    if (hit === null) return null;
    const from = ctx.pos - hit.query.length - 1; // offset of the '#'
    const cands = tagCandidates([...app.metadata.getTagMap().keys()], hit.query);
    if (cands.length === 0) return null;
    const options: Completion[] = cands.map((tag) => ({ label: `#${tag}`, apply: `#${tag}` }));
    // filter:false (pre-ranked); no validFor → CM re-runs per keystroke (live narrow).
    return { from, options, filter: false };
  };
}
