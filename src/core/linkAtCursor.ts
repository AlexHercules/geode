/**
 * R201: find the link under the cursor on a single editor line, so
 * editor:follow-link / editor:open-link-in-new-leaf can navigate it. Pure string
 * scan (no CM/React deps) → testable via the `__geodeLinkAtCursor` probe.
 *
 * Scans the line for wikilinks `[[…]]` / `![[…]]` and markdown links `[..](href)`,
 * returning the FIRST whose absolute span contains the cursor offset (inclusive at
 * both ends, so the cursor at a bracket edge still counts as "on" the link).
 * Wikilinks are matched first (Geode's primary link type).
 */
export interface LinkAtCursor {
  kind: "wikilink" | "markdown";
  /** wikilink target / markdown href, before any `#` subpath (alias dropped) */
  target: string;
  /** the raw text after the first `#` (heading / `^block`), or "" */
  subpath: string;
  from: number;
  to: number;
  /** markdown href with a URL scheme (http(s)/mailto/tel) — open externally, not in a tab */
  external: boolean;
}

const WIKILINK_RE = /(!?)\[\[([^[\]]+?)\]\]/g;
// href allows one level of balanced parens (CommonMark / markdown-it), so a URL like
// `…/Foo_(bar)` is not truncated at the first ')'.
const MDLINK_RE = /\[[^\]]*\]\(((?:[^()]|\([^()]*\))+)\)/g;
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:)/i;

/** Split a link body at its first `#` into [target, subpath]. */
function splitSubpath(body: string): [string, string] {
  const hash = body.indexOf("#");
  return hash === -1 ? [body, ""] : [body.slice(0, hash), body.slice(hash + 1)];
}

export function linkAtCursor(line: string, lineStart: number, cursor: number): LinkAtCursor | null {
  const rel = cursor - lineStart;
  for (const m of line.matchAll(WIKILINK_RE)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (rel < from || rel > to) continue;
    const [target, subpath] = splitSubpath(m[2].split("|")[0]); // drop the |alias for navigation
    return { kind: "wikilink", target: target.trim(), subpath, from: lineStart + from, to: lineStart + to, external: false };
  }
  for (const m of line.matchAll(MDLINK_RE)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (rel < from || rel > to) continue;
    const href = m[1].trim();
    const [target, subpath] = splitSubpath(href);
    return { kind: "markdown", target, subpath, from: lineStart + from, to: lineStart + to, external: EXTERNAL_RE.test(href) };
  }
  return null;
}
