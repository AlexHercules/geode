/**
 * Unlinked-mentions engine (R24) — find plain-text occurrences of the active
 * note's name (basename + frontmatter aliases) in OTHER notes that are not yet
 * wrapped in a `[[..]]` wikilink, and rewrite them into links on demand. See
 * ARCHITECTURE.md "Round 24 additions" for the frozen contract.
 *
 * Two halves:
 *  - the matcher (`deriveMentionTerms` / `findUnlinkedMentions`) is pure,
 *    synchronous and never throws — it just scans a given content string.
 *  - the link engine (`linkAllMentionsInFile` / `linkOneMention`) writes OTHER
 *    files (possibly open in the editor) and therefore mirrors the R16
 *    linkRewrite write-discipline EXACTLY: its own module-level `runTail`
 *    serialization queue; flushAll + ensureFresh before every run; the source
 *    of truth is the open buffer (`documents.get`) else a cache-bypassing
 *    `vault.readFresh` (NEVER the content cache — a watcher-debounce-window
 *    external edit is invisible to it); mentions are RE-DERIVED from that fresh
 *    content (offsets correct by construction — the stale scan offsets shown in
 *    the panel are NEVER blind-spliced); edits are built ascending and the
 *    string is rebuilt like linkRewrite; the apply path is
 *    `handle.applyExternalEdits` for open buffers else `vault.modify`; every run
 *    is wrapped per-file in try/catch → skip + report, never a blind write.
 */
import type { NoteMetadata } from "./types";
import type { Vault } from "./vault";
import { maskCodeRegions, parseNote, type MetadataIndex } from "./metadata";
import type { DocumentManager } from "./documents";

/** One plain-text mention: [from,to) is a code-unit span of the source file's
 *  content and `text` is the matched original-case slice. */
export interface MentionSpan {
  from: number;
  to: number;
  text: string;
}

/* ------------------------------------------------------------------ */
/* matcher (pure)                                                      */
/* ------------------------------------------------------------------ */

/** A word-ish code point for boundary purposes: Letter / Number / underscore. */
const LATIN_WORD_RE = /[\p{L}\p{N}_]/u;
/** CJK scripts that have no inter-word separator, plus fullwidth forms. Per the
 *  frozen contract these are treated as NON-Latin-word so a CJK name matches as
 *  a bare substring (Obsidian's behaviour — CJK has no word boundaries). */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}＀-￯]/u;

/**
 * isLatinWord(ch) (frozen): ch ∈ \p{L}\p{N}_ AND ch is NOT CJK (Han incl.
 * extensions / Hiragana / Katakana / Hangul / fullwidth). `ch` is a single code
 * point (string). Empty / null (document edge) is NOT a word char.
 */
function isLatinWord(ch: string | null): boolean {
  if (!ch) return false;
  if (!LATIN_WORD_RE.test(ch)) return false;
  if (CJK_RE.test(ch)) return false;
  return true;
}

/** The full code point that STARTS at index `i` (handles surrogate pairs), or
 *  null at/after the string end. */
function codePointAt(s: string, i: number): string | null {
  if (i < 0 || i >= s.length) return null;
  const cp = s.codePointAt(i);
  return cp === undefined ? null : String.fromCodePoint(cp);
}

/** The full code point that ENDS just before index `i` (handles surrogate
 *  pairs), or null at/before the string start. */
function codePointBefore(s: string, i: number): string | null {
  if (i <= 0) return null;
  const lo = s.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = s.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) {
      return String.fromCodePoint((hi - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000);
    }
  }
  return s[i - 1];
}

/**
 * Frozen boundary rule. A span [from,to) of `content` is a valid mention iff
 * NEITHER edge "fails". An edge FAILS (would cut a Latin word in half) iff BOTH
 * the match's inside-edge char and the adjacent outside char are isLatinWord.
 * A document edge or a non-word neighbour always passes. So Latin "Note" does
 * NOT match inside "Notebook" (inner `e` + outer `b` both Latin → right edge
 * fails), while CJK names match as bare substrings (neighbours are non-Latin).
 */
function edgesOk(content: string, from: number, to: number): boolean {
  const leftInside = codePointAt(content, from);
  const leftOutside = codePointBefore(content, from);
  if (isLatinWord(leftInside) && isLatinWord(leftOutside)) return false;
  const rightInside = codePointBefore(content, to);
  const rightOutside = codePointAt(content, to);
  if (isLatinWord(rightInside) && isLatinWord(rightOutside)) return false;
  return true;
}

/**
 * The active note's matching terms = basename (without `.md`) + every
 * frontmatter alias. Trimmed, empty dropped, case-insensitively de-duplicated
 * (first authored casing wins). Derived once per active note and reused across
 * every source file in the scan.
 */
export function deriveMentionTerms(meta: NoteMetadata): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const t = raw.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  add((meta.path.split("/").pop() ?? meta.path).replace(/\.md$/i, ""));
  for (const alias of meta.aliases) add(alias);
  return out;
}

/**
 * Build a same-length masked copy of `content` (every excluded region replaced
 * by spaces so offsets stay aligned) covering, per the frozen contract:
 *  - the frontmatter region [0, frontmatter.to)
 *  - code fences + inline code (`maskCodeRegions` — the same helper parseNote
 *    uses, so recognition never diverges)
 *  - existing wikilink spans (`sourceMeta.links` from/to)
 *  - tag spans (`sourceMeta.tags` with from>0 — i.e. body `#tag`, not the
 *    frontmatter `tags:` entries which carry from===0 — length 1+tag.length).
 * Hence `[[Name]]`, `#Name`, and names inside code / frontmatter are never
 * reported as unlinked mentions.
 */
function buildMasked(content: string, sourceMeta: NoteMetadata): string {
  let masked = content;
  const fmTo = sourceMeta.frontmatter?.to ?? 0;
  if (fmTo > 0) masked = " ".repeat(Math.min(fmTo, content.length)) + content.slice(fmTo);
  masked = maskCodeRegions(masked);

  const chars = masked.split("");
  const blank = (from: number, to: number): void => {
    for (let i = Math.max(0, from); i < to && i < chars.length; i++) chars[i] = " ";
  };
  for (const link of sourceMeta.links) blank(link.from, link.to);
  // Same-file subpath links `[[#Heading]]` / `[[#^block]]` carry no target so
  // WIKILINK_RE never captures them into sourceMeta.links — blank them here so a
  // mention of the active note's name inside one isn't reported / linked into
  // `[[#[[Name]]]]` (R24 review C4). Scanned over `masked` (code already blanked).
  for (const m of masked.matchAll(/\[\[#[^[\]]*\]\]/g)) {
    blank(m.index!, m.index! + m[0].length);
  }
  for (const tag of sourceMeta.tags) {
    // A real body `#tag` points at '#' (TAG_RE: from = m.index + leading.length),
    // including at file offset 0. Synthetic frontmatter tags carry from===0 but
    // point at the leading '-' of '---' (already inside the blanked frontmatter
    // region), so gate on the actual byte, not the offset — otherwise a column-0
    // body `#Name` leaks through and Link corrupts it to `#[[Name]]` (R24 review C1).
    if (content[tag.from] === "#") blank(tag.from, tag.from + 1 + tag.tag.length);
  }
  return chars.join("");
}

/**
 * Find unlinked plain-text occurrences of `terms` in a source file's `content`
 * (frozen semantics — see the JSDoc on the contract):
 *  - scan the masked content (frontmatter + code + existing links + tags
 *    blanked, offsets aligned);
 *  - case-insensitive substring match (offset-safe: a masked slice is accepted
 *    only when its lowercase equals the term's, preserving the 1:1 code-unit
 *    mapping);
 *  - the CJK-aware boundary rule (`edgesOk`) gates every candidate;
 *  - overlap dedup: gather all candidates across terms, sort by `from` asc then
 *    length desc, greedily keep non-overlapping (longest wins — avoids nesting
 *    links). Result is sorted by `from` ascending.
 * Never throws.
 */
export function findUnlinkedMentions(
  content: string,
  sourceMeta: NoteMetadata,
  terms: readonly string[],
): MentionSpan[] {
  if (content.length === 0 || terms.length === 0) return [];
  const masked = buildMasked(content, sourceMeta);

  const candidates: MentionSpan[] = [];
  for (const term of terms) {
    const tLen = term.length;
    if (tLen === 0) continue;
    const tLower = term.toLowerCase();
    // O(n·m) per term — terms are short and few; offset-safe vs toLowerCase
    // length changes (a slice whose lowercase grows simply won't compare equal)
    for (let i = 0; i + tLen <= masked.length; i++) {
      // cheap first-char gate before the slice/allocation
      if (masked[i] === " ") continue;
      const slice = masked.slice(i, i + tLen);
      if (slice.toLowerCase() !== tLower) continue;
      if (!edgesOk(content, i, i + tLen)) continue;
      candidates.push({ from: i, to: i + tLen, text: content.slice(i, i + tLen) });
    }
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const out: MentionSpan[] = [];
  let lastTo = -1;
  for (const c of candidates) {
    if (c.from < lastTo) continue; // overlaps an already-kept (longer/earlier) span
    out.push(c);
    lastTo = c.to;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* link engine (writes — R16 discipline)                              */
/* ------------------------------------------------------------------ */

export interface MentionLinkDeps {
  vault: Vault;
  metadata: MetadataIndex;
  documents: DocumentManager;
}

export interface MentionLinkResult {
  filesChanged: number;
  mentionsLinked: number;
  skipped: Array<{ path: string; reason: string }>;
}

/** Serializes engine runs (mirrors linkRewrite's runTail). Concurrent
 *  Link / Link-all actions on the same source file would otherwise interleave
 *  read→write and drop each other's edits. Each run re-flushes + re-reads +
 *  re-derives, so a queued run always sees its predecessor's result. A failed
 *  predecessor never poisons the queue. */
let runTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = runTail.then(fn, fn);
  runTail = run.catch(() => {});
  return run;
}

/**
 * Insert text for a mention (frozen): surfaceText = the matched content slice.
 * If `resolveLink(surfaceText, sourcePath) === activePath` → `[[surfaceText]]`
 * (the surface already resolves — alias / any casing, Obsidian's rule).
 * Otherwise try the disambiguating full path `[[fullPathNoExt|surfaceText]]`
 * and verify IT resolves to activePath; if neither resolves, throw (the caller
 * turns this into skip + report).
 */
function buildLinkInsert(
  metadata: MetadataIndex,
  surfaceText: string,
  activePath: string,
  sourcePath: string,
): string {
  if (metadata.resolveLink(surfaceText, sourcePath) === activePath) {
    return `[[${surfaceText}]]`;
  }
  const fullPathNoExt = activePath.replace(/\.md$/i, "");
  if (metadata.resolveLink(fullPathNoExt, sourcePath) === activePath) {
    return `[[${fullPathNoExt}|${surfaceText}]]`;
  }
  throw new Error(
    `no resolvable link form for mention "${surfaceText}" -> ${activePath}`,
  );
}

/** Locate the single fresh mention that matches a panel target: exact `from`
 *  wins; otherwise the same-`text` mention nearest by offset within a tolerance
 *  (the source may have shifted since the scan); beyond tolerance → null
 *  ("content changed"). */
function pickMention(mentions: MentionSpan[], target: MentionSpan): MentionSpan | null {
  const exact = mentions.find((m) => m.from === target.from && m.text === target.text);
  if (exact) return exact;
  let best: MentionSpan | null = null;
  let bestDist = Infinity;
  for (const m of mentions) {
    if (m.text !== target.text) continue;
    const d = Math.abs(m.from - target.from);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  const TOLERANCE = 200; // code units of drift tolerated before "content changed"
  return best !== null && bestDist <= TOLERANCE ? best : null;
}

/**
 * Core write path shared by `linkAllMentionsInFile` (target===null → link every
 * current mention) and `linkOneMention` (target!==null → link the one located
 * by `pickMention`). Implements the full R16 write discipline; never throws,
 * always returns a report.
 */
async function doLink(
  deps: MentionLinkDeps,
  activePath: string,
  sourcePath: string,
  target: MentionSpan | null,
): Promise<MentionLinkResult> {
  const { vault, metadata, documents } = deps;
  const result: MentionLinkResult = { filesChanged: 0, mentionsLinked: 0, skipped: [] };

  // ① converge buffers + index so terms and resolution reflect the latest edits
  //    (a flush may fail on a locked file — the buffer-text provider keeps the
  //    index converged regardless).
  await documents.flushAll();
  await metadata.ensureFresh(documents.getOpenPaths(), (p) => documents.get(p)?.getText());

  // terms from the FRESH active note metadata
  const activeMeta = metadata.getMetadata(activePath);
  if (!activeMeta) {
    result.skipped.push({ path: sourcePath, reason: "active note not in index" });
    return result;
  }
  const terms = deriveMentionTerms(activeMeta);
  if (terms.length === 0) return result; // nothing nameable to link

  try {
    // ② source of truth: open buffer else DISK (never the content cache)
    const handle = documents.get(sourcePath);
    const content = handle !== null ? handle.getText() : await vault.readFresh(sourcePath);

    // ③ re-derive mentions from fresh content — offsets correct by construction
    const sourceMeta = parseNote(sourcePath, content);
    const mentions = findUnlinkedMentions(content, sourceMeta, terms);

    let targets: MentionSpan[];
    if (target === null) {
      targets = mentions;
    } else {
      const picked = pickMention(mentions, target);
      if (picked === null) {
        result.skipped.push({ path: sourcePath, reason: "content changed" });
        return result;
      }
      targets = [picked];
    }
    if (targets.length === 0) return result;

    // ④ build ascending, non-overlapping edits (mentions are already sorted)
    const edits = targets.map((m) => ({
      from: m.from,
      to: m.to,
      insert: buildLinkInsert(metadata, content.slice(m.from, m.to), activePath, sourcePath),
    }));

    // rebuild the rewritten string the way linkRewrite does
    let rewritten = "";
    let pos = 0;
    for (const e of edits) {
      rewritten += content.slice(pos, e.from) + e.insert;
      pos = e.to;
    }
    rewritten += content.slice(pos);

    // post-rewrite verification (R16 parity, linkRewrite.ts:286-295): reparse the
    // rewritten content and assert every inserted link actually resolves back to
    // the active note. A name/alias carrying a wikilink metacharacter (`C#`,
    // `F#`, `a|b`, `Foo[1]`) would otherwise serialize to `[[C#]]` (parses to
    // target "C") or junk — a silent WRONG/broken cross-file link. Any mismatch
    // throws → the per-file try/catch turns it into skip+report, never a blind
    // bad write (R24 review C2/C5). Such names are Obsidian-illegal anyway, so
    // skipping them is the faithful outcome.
    const reparsed = parseNote(sourcePath, rewritten);
    let delta = 0;
    for (const e of edits) {
      const at = e.from + delta;
      delta += e.insert.length - (e.to - e.from);
      const link = reparsed.links.find((l) => l.from === at);
      if (!link || metadata.resolveLink(link.target, sourcePath) !== activePath) {
        throw new Error(
          `post-rewrite verification failed at ${at} for "${content.slice(e.from, e.to)}"`,
        );
      }
    }

    // ⑤ apply: open buffer → single CM transaction (undo one step, dirty +
    //    debounced save); closed file → Vault.modify (echo-fingerprint suppressed)
    if (handle !== null) {
      handle.applyExternalEdits(edits);
    } else {
      await vault.modify(sourcePath, rewritten);
    }
    result.filesChanged = 1;
    result.mentionsLinked = edits.length;
  } catch (err) {
    // ⑥ per-file skip + report — never a blind write
    const reason = err instanceof Error ? err.message : String(err);
    result.skipped.push({ path: sourcePath, reason });
    console.warn(`[unlinkedMentions] skipped ${sourcePath}: ${reason}`);
  }
  return result;
}

/**
 * Link EVERY current unlinked mention of `activePath` inside `sourcePath`
 * (re-derived from fresh content, all linked in one edit). Serialized via the
 * module `runTail`. See `doLink` / `buildLinkInsert` for the frozen semantics.
 */
export function linkAllMentionsInFile(
  deps: MentionLinkDeps,
  activePath: string,
  sourcePath: string,
): Promise<MentionLinkResult> {
  return enqueue(() => doLink(deps, activePath, sourcePath, null));
}

/**
 * Link ONE mention inside `sourcePath` (located in fresh content by
 * `pickMention` from the panel's `target` span; out-of-tolerance →
 * skip + report "content changed"). Serialized via the module `runTail`.
 */
export function linkOneMention(
  deps: MentionLinkDeps,
  activePath: string,
  sourcePath: string,
  target: MentionSpan,
): Promise<MentionLinkResult> {
  return enqueue(() => doLink(deps, activePath, sourcePath, target));
}
