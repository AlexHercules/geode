import type {
  BacklinkEntry,
  BlockRef,
  FileNode,
  FootnoteRef,
  FrontmatterData,
  GraphData,
  GraphEdge,
  GraphNode,
  HeadingRef,
  LinkRef,
  NoteMetadata,
  TagRef,
} from "./types";
import type { Vault } from "./vault";
import { EventBus } from "./events";
import { Store } from "./store";

const WIKILINK_RE = /\[\[([^\[\]\|#]+)(?:#[^\[\]\|]*)?(?:\|([^\[\]]*))?\]\]/g;
/** Standard markdown inline link/image `[text](href)` / `![alt](href "title")`
 *  (R70). m[1]=optional `!`, m[2]=text, m[3]=href (no whitespace/`)`). Title is
 *  matched-and-discarded. Reference-style `[a][b]` and angle `(<url>)` forms are
 *  out of scope (Obsidian writes bare hrefs, %20-encoding spaces). */
const MARKDOWN_LINK_RE = /(!?)\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g;
/** Inline `#tag` recognition (frozen): a tag follows a line-start/space/`(`
 *  boundary (m[1]) and its body (m[2], no leading #) admits `/` for nesting and
 *  BMP CJK. Exported so `core/tagRewrite.ts` scans tags with the EXACT same
 *  regex the indexer uses — detector/rewriter never diverge (R68 lesson). */
export const TAG_RE = /(^|[\s(])#([A-Za-z0-9_\/\-一-鿿]+)/g;
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;
const CODE_FENCE_RE = /```[\s\S]*?(```|$)/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
/** Trailing `^block-id` marker at a line end (R13, frozen contract regex). */
const BLOCK_MARKER_RE = /\s\^([A-Za-z0-9-]+)\s*$/;
/** `[^id]: content` footnote definition line (R65, ㉘). id charset matches the
 *  frozen R18 reading-view contract (markdown.ts FOOTNOTE_DEF_RE); multiline so
 *  matchAll yields every definition with its line-start offset. Column-0 anchored
 *  like HEADING_RE / TAG_RE / BLOCK_MARKER_RE (the codebase convention — indented
 *  defs are out of scope, same as indented headings for the outline pane). */
const FOOTNOTE_DEF_RE = /^\[\^([^\s[\]]+)\]:.*$/gm;

/**
 * Blank out code-fence and inline-code regions with same-length runs of spaces
 * so links/tags/mentions inside them are ignored while every downstream offset
 * stays byte-aligned with the input (R24 pure extraction — byte-for-byte the
 * same logic `parseNote` used inline since R13). Reused by
 * `core/unlinkedMentions.ts` so fence / inline-code recognition lives in exactly
 * one place and never diverges between the two scanners.
 */
export function maskCodeRegions(s: string): string {
  return s
    .replace(CODE_FENCE_RE, (m) => " ".repeat(m.length))
    .replace(INLINE_CODE_RE, (m) => " ".repeat(m.length));
}

/** Span of a link subpath target inside a note (R14, frozen contract). */
export interface SubpathSpan {
  kind: "heading" | "block";
  /** anchor start (heading line start / block paragraph start) */
  from: number;
  /** range end: heading = section end (start of the next heading with
   *  level <= it, else end of file); block = block paragraph end */
  to: number;
}

/** Markdown-stripped, space-collapsed, lowercased heading text — mirrors
 *  Obsidian's stripHeading link-matching semantics (loose second pass only;
 *  the exact raw-text match always wins first). Moved here from core/embeds.ts
 *  in R14 so resolveSubpath owns all heading-matching logic. */
export function stripHeadingText(text: string): string {
  return text
    .replace(/[*_`~]|\[\[|\]\]|[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Parse a leading YAML frontmatter block (minimal subset: scalar values,
 * inline lists `[a, b]`, and block lists). Returns null if absent.
 */
export function parseFrontmatter(content: string): FrontmatterData | null {
  if (!content.startsWith("---")) return null;
  const firstLineEnd = content.indexOf("\n");
  if (firstLineEnd === -1 || content.slice(0, firstLineEnd).trim() !== "---") return null;
  const close = content.indexOf("\n---", firstLineEnd);
  if (close === -1) return null;
  const closeLineEnd = content.indexOf("\n", close + 1);
  const to = closeLineEnd === -1 ? content.length : closeLineEnd + 1;
  const body = content.slice(firstLineEnd + 1, close + 1);

  const fields: Record<string, string | string[]> = {};
  let currentKey: string | null = null;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim()) continue;
    const itemMatch = /^\s+-\s+(.+)$/.exec(line);
    if (itemMatch && currentKey) {
      const list = fields[currentKey];
      const value = unquote(itemMatch[1]);
      if (Array.isArray(list)) list.push(value);
      else fields[currentKey] = [value];
      continue;
    }
    const kv = /^([A-Za-z0-9_\-. ]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    // keys keep their authored case (Obsidian-faithful shape for plugins);
    // well-known fields are looked up case-insensitively via fmField()
    const key = kv[1].trim();
    const raw = kv[2].trim();
    currentKey = key;
    if (!raw) {
      fields[key] = []; // block list (or empty) follows
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      fields[key] = raw
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s))
        .filter(Boolean);
    } else {
      fields[key] = unquote(raw);
    }
  }
  return { fields, from: 0, to };
}

function unquote(s: string): string {
  const t = s.trim();
  return /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t;
}

/** Normalize a frontmatter field value to a trimmed, non-empty string list
 *  (scalar → comma-split). Exported so `core/tagRewrite.ts` reads `tags:` values
 *  through the same lens the indexer uses. */
export function asList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean);
}

/** Case-insensitive frontmatter field lookup (keys keep their authored case). */
export function fmField(
  fields: Record<string, string | string[]>,
  name: string,
): string | string[] | undefined {
  if (name in fields) return fields[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(fields)) {
    if (k.toLowerCase() === lower) return fields[k];
  }
  return undefined;
}

/** Parse one markdown document into metadata. Exported for tests/reuse. */
export function parseNote(path: string, content: string): NoteMetadata {
  const frontmatter = parseFrontmatter(content) ?? undefined;
  // blank out frontmatter + code regions so links/tags inside are ignored,
  // while keeping offsets stable
  const withoutFm = frontmatter
    ? " ".repeat(frontmatter.to) + content.slice(frontmatter.to)
    : content;
  const masked = maskCodeRegions(withoutFm);

  const links: LinkRef[] = [];
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const target = m[1].trim();
    if (!target) continue;
    links.push({
      target,
      alias: m[2]?.trim() || undefined,
      from: m.index!,
      to: m.index! + m[0].length,
      context: makeSnippet(content, m.index!, m.index! + m[0].length),
      kind: "wikilink",
    });
  }
  // R70: standard markdown links `[text](href)` — indexed so file renames can
  // rewrite them too (R16 closed only wikilinks). Image embeds `![](…)` (m[1]),
  // external schemes (`https:` / `mailto:` …), protocol-relative `//`, and pure
  // same-file anchors `#x` are NOT vault links → skipped. The raw href is kept
  // verbatim as the target (resolveMarkdownLink decodes/strips at resolution).
  for (const m of masked.matchAll(MARKDOWN_LINK_RE)) {
    if (m[1] === "!") continue; // image embed — markdown embeds deferred (㉞ follow-up)
    const href = m[3];
    if (href.startsWith("#") || href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    links.push({
      target: href,
      alias: m[2] || undefined,
      from: m.index!,
      to: m.index! + m[0].length,
      context: makeSnippet(content, m.index!, m.index! + m[0].length),
      kind: "markdown",
    });
  }

  const tags: TagRef[] = [];
  for (const m of masked.matchAll(TAG_RE)) {
    tags.push({ tag: m[2], from: m.index! + m[1].length });
  }

  const headings: HeadingRef[] = [];
  for (const m of masked.matchAll(HEADING_RE)) {
    headings.push({ level: m[1].length, text: m[2].trim(), from: m.index! });
  }

  // R65: footnote definitions `[^id]: content`. Matched on `masked` (so defs
  // inside fenced/inline code are excluded and offsets line up with `content`),
  // but the content text is sliced from the ORIGINAL `content` so inline code in
  // the body survives un-masked. The content offset is taken from the `]:`
  // boundary (the id charset excludes `]`, so the FIRST `]:` is the definition's)
  // — NOT from a masked content-group length, which would drop a leading inline-
  // code span (masking blanks it; a greedy `[ \t]*` would then eat the blanks).
  // Duplicate ids keep BOTH (document order). Multi-line continuation lines are
  // not merged (panel shows a single-line preview); col-0 anchored (see RE).
  const footnotes: FootnoteRef[] = [];
  for (const m of masked.matchAll(FOOTNOTE_DEF_RE)) {
    const afterColon = m.index! + m[0].indexOf("]:") + 2;
    footnotes.push({
      id: m[1],
      content: content.slice(afterColon, m.index! + m[0].length).trim(),
      from: m.index!,
    });
  }

  // `^block-id` markers at line ends (R13). Scanned against `masked` (all
  // replacements are same-length, so offsets line up with `content`), which
  // excludes fences, inline code and the frontmatter block. A block span is
  // the contiguous run of non-blank lines containing the marker line
  // (paragraph approximation), expanded up/down to blank lines or the
  // document edges; the frontmatter region counts as blank so spans never
  // reach into it. Duplicate ids (case-insensitive): the LATER one wins,
  // mirroring the official Record<string, BlockCache> overwrite semantics.
  const blocks: BlockRef[] = [];
  {
    const blockIndexById = new Map<string, number>(); // lowercased id -> index
    const lineStarts: number[] = [0];
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1);
    }
    const lineCount = lineStarts.length;
    const lineEndAt = (li: number): number => {
      let end = li + 1 < lineCount ? lineStarts[li + 1] - 1 : content.length;
      if (end > lineStarts[li] && content.charCodeAt(end - 1) === 13 /* \r */) end--;
      return end;
    };
    const isBlank = (li: number): boolean =>
      withoutFm.slice(lineStarts[li], lineEndAt(li)).trim() === "";
    for (let li = 0; li < lineCount; li++) {
      const m = BLOCK_MARKER_RE.exec(masked.slice(lineStarts[li], lineEndAt(li)));
      if (!m) continue;
      let start = li;
      while (start > 0 && !isBlank(start - 1)) start--;
      let end = li;
      while (end + 1 < lineCount && !isBlank(end + 1)) end++;
      const ref: BlockRef = { id: m[1], from: lineStarts[start], to: lineEndAt(end) };
      const existing = blockIndexById.get(m[1].toLowerCase());
      if (existing !== undefined) blocks[existing] = ref;
      else {
        blockIndexById.set(m[1].toLowerCase(), blocks.length);
        blocks.push(ref);
      }
    }
  }

  // frontmatter contributes tags + aliases to the index
  const fm = frontmatter?.fields ?? {};
  const aliases = asList(fmField(fm, "aliases") ?? fmField(fm, "alias"));
  for (const raw of asList(fmField(fm, "tags") ?? fmField(fm, "tag"))) {
    // frontmatter can author junk (`["#", "bad space"]`); a real tag is non-empty
    // and whitespace-free — drop the rest so the index / Tags pane / `#` completion
    // never surface broken tag tokens (R41 review).
    const tag = raw.replace(/^#/, "").trim();
    if (tag !== "" && !/\s/.test(tag)) tags.push({ tag, from: 0 });
  }

  return {
    path,
    links,
    tags,
    headings,
    blocks,
    footnotes,
    frontmatter,
    aliases,
    contentLength: content.length,
  };
}

/**
 * MetadataIndex — maintains parsed metadata for every markdown file and
 * derives: link resolution, backlinks, the global graph, and the tag map.
 * Rebuilds incrementally on vault events; emits "metadata:updated".
 */
export class MetadataIndex {
  /** bumped on every reindex so React views can subscribe cheaply */
  readonly revision = new Store(0);
  private byPath = new Map<string, NoteMetadata>();
  /** lowercase basename (no ext) -> set of full paths */
  private nameToPaths = new Map<string, Set<string>>();
  /** lowercase full path -> canonical path (O(1) exact-path link resolution) */
  private lowerPathToPath = new Map<string, string>();
  /** lazily built non-markdown attachment lookup; null = stale (rebuild on demand) */
  private attachmentMaps: {
    lowerPathToPath: Map<string, string>;
    lowerBasenameToPaths: Map<string, string[]>;
  } | null = null;
  /** R22: lazy vault-wide frontmatter key list, cached per revision */
  private propertyKeysCache: { rev: number; keys: string[] } | null = null;
  /** R30: lazy vault-wide frontmatter key → file count, cached per revision */
  private propertyKeyCountsCache: { rev: number; counts: Map<string, number> } | null = null;
  /** R41: tag → file-set cache, keyed on the index revision (the `#` completion
   *  hot path + Tags pane both call getTagMap per keystroke/render). */
  private tagMapCache: { rev: number; map: Map<string, Set<string>> } | null = null;

  constructor(
    private vault: Vault,
    private events: EventBus,
  ) {
    events.on("vault:changed", ({ reason }) => {
      // any tree mutation (load/create/rename/delete/external) may add or remove
      // attachments — drop the lazy maps and rebuild on next resolveAttachment()
      this.attachmentMaps = null;
      if (reason === "load") void this.rebuildAll();
    });
    events.on("file:modified", ({ path }) => void this.reindexFile(path));
    events.on("file:created", ({ path }) => void this.reindexFile(path));
    events.on("file:deleted", ({ path }) => this.dropPath(path));
    events.on("file:renamed", ({ oldPath, newPath }) => {
      if (newPath.toLowerCase().endsWith(".md")) {
        this.dropPath(oldPath, false);
        void this.reindexFile(newPath);
      } else {
        // folder rename: drop the old subtree, re-index everything under newPath
        void this.reindexFolder(oldPath, newPath);
      }
    });
  }

  /* ---------- indexing ---------- */

  async rebuildAll(): Promise<void> {
    const t0 = performance.now();
    this.byPath.clear();
    this.nameToPaths.clear();
    await this.indexFiles(this.vault.getMarkdownFiles());
    this.rebuildNameMap();
    perfMark("metadataIndexMs", performance.now() - t0);
    perfMark("metadataFiles", this.byPath.size);
    this.bump();
  }

  /** Parse a list of files with a small worker pool (bounded concurrency). */
  private async indexFiles(files: FileNode[], concurrency = 8): Promise<void> {
    let next = 0; // index cursor — Array.shift() would be O(n²) on 10k files
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= files.length) return;
        const f = files[i];
        try {
          const content = await this.vault.read(f.path);
          this.byPath.set(f.path, parseNote(f.path, content));
        } catch (err) {
          console.warn(`[metadata] failed to index ${f.path}`, err);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, files.length) }, worker),
    );
  }

  private async reindexFile(path: string): Promise<void> {
    if (!path.toLowerCase().endsWith(".md")) return;
    // guard against late events for files that no longer exist (ghost entries)
    if (!this.vault.fileExists(path)) {
      if (this.byPath.delete(path)) {
        this.rebuildNameMap();
        this.bump();
      }
      return;
    }
    try {
      const content = await this.vault.read(path);
      this.byPath.set(path, parseNote(path, content));
    } catch {
      this.byPath.delete(path);
    }
    this.rebuildNameMap();
    this.bump();
  }

  /** Folder rename: drop the old subtree, then index every md file under newPath. */
  private async reindexFolder(oldPath: string, newPath: string): Promise<void> {
    this.dropPath(oldPath, false);
    const prefix = newPath + "/";
    const files = this.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
    await this.indexFiles(files);
    this.rebuildNameMap();
    this.bump();
  }

  /** Re-parse the given paths from CURRENT vault content right now (missing
   *  paths skipped and dropped from the index), rebuild the name map, bump
   *  once. Deterministic alternative to waiting for the async event-driven
   *  reindex (R16 link-rewrite capture/verify phases). Non-.md paths ignored.
   *  `readText` (R16 review fix): optional in-memory source — a live editor
   *  buffer must win over disk so capture-phase discovery still converges
   *  when a flush failed (locked/read-only file); persistence may lag, the
   *  index must not. */
  async ensureFresh(
    paths: string[],
    readText?: (path: string) => string | undefined,
  ): Promise<void> {
    for (const path of paths) {
      if (!path.toLowerCase().endsWith(".md")) continue;
      const buffered = readText?.(path);
      if (buffered !== undefined) {
        this.byPath.set(path, parseNote(path, buffered));
        continue;
      }
      if (!this.vault.fileExists(path)) {
        this.byPath.delete(path);
        continue;
      }
      try {
        const content = await this.vault.read(path);
        this.byPath.set(path, parseNote(path, content));
      } catch (err) {
        console.warn(`[metadata] ensureFresh failed to read ${path}`, err);
        this.byPath.delete(path);
      }
    }
    this.rebuildNameMap();
    this.bump();
  }

  private dropPath(path: string, bump = true) {
    // path may be a folder: drop everything under it
    for (const key of [...this.byPath.keys()]) {
      if (key === path || key.startsWith(path + "/")) this.byPath.delete(key);
    }
    this.rebuildNameMap();
    if (bump) this.bump();
  }

  private rebuildNameMap() {
    this.nameToPaths.clear();
    this.lowerPathToPath.clear();
    for (const path of this.byPath.keys()) this.lowerPathToPath.set(path.toLowerCase(), path);
    const add = (name: string, path: string) => {
      const key = name.toLowerCase();
      if (!key) return;
      let set = this.nameToPaths.get(key);
      if (!set) this.nameToPaths.set(key, (set = new Set()));
      set.add(path);
    };
    for (const meta of this.byPath.values()) {
      add((meta.path.split("/").pop() ?? meta.path).replace(/\.md$/i, ""), meta.path);
      // frontmatter aliases resolve like real names (Obsidian behaviour)
      for (const alias of meta.aliases) add(alias, meta.path);
    }
  }

  private bump() {
    this.revision.update((n) => n + 1);
    this.events.emit("metadata:updated", {});
  }

  /* ---------- queries ---------- */

  getMetadata(path: string): NoteMetadata | undefined {
    return this.byPath.get(path);
  }

  getAll(): NoteMetadata[] {
    return [...this.byPath.values()];
  }

  /**
   * Resolve a link subpath (the text after '#', WITHOUT the '#') inside a
   * note to a document span (R14, frozen contract).
   *  - `^id` → block reference: case-insensitive id match against the block
   *    index; span = the whole block (paragraph approximation, marker incl.).
   *  - anything else → heading: exact case-insensitive text match first, then
   *    a stripHeadingText second pass (Obsidian's stripHeading semantics —
   *    "# **Bold**" is referenced as "[[note#Bold]]"); span = from the
   *    heading line up to (exclusive) the next heading of the same or higher
   *    level, else end of file — Obsidian behaviour.
   * Unknown path / empty subpath / no match → null.
   */
  resolveSubpath(path: string, subpath: string): SubpathSpan | null {
    const meta = this.byPath.get(path);
    if (!meta) return null;
    const sub = subpath.trim();
    if (!sub) return null;
    if (sub.startsWith("^")) {
      const lower = sub.slice(1).toLowerCase();
      const hit = meta.blocks.find((b) => b.id.toLowerCase() === lower);
      return hit ? { kind: "block", from: hit.from, to: hit.to } : null;
    }
    const headings = meta.headings;
    const lower = sub.toLowerCase();
    let idx = headings.findIndex((h) => h.text.toLowerCase() === lower);
    if (idx === -1) {
      const stripped = stripHeadingText(sub);
      idx = headings.findIndex((h) => stripHeadingText(h.text) === stripped);
    }
    if (idx === -1) return null;
    const hit = headings[idx];
    let to = meta.contentLength;
    for (let i = idx + 1; i < headings.length; i++) {
      if (headings[i].level <= hit.level) {
        to = headings[i].from;
        break;
      }
    }
    return { kind: "heading", from: hit.from, to };
  }

  /**
   * Obsidian-style link resolution:
   *  - exact vault path (with or without .md)
   *  - else basename match (case-insensitive); prefer file in same folder
   * Returns the resolved vault path or null (unresolved link).
   */
  resolveLink(target: string, fromPath: string): string | null {
    const clean = target.replace(/\.md$/i, "").trim();
    if (!clean) return null;
    const asPath = clean.includes("/") ? clean + ".md" : null;
    if (asPath) {
      const exact = this.lowerPathToPath.get(asPath.toLowerCase());
      if (exact) return exact;
    }
    const candidates = this.nameToPaths.get(clean.split("/").pop()!.toLowerCase());
    if (!candidates || candidates.size === 0) return null;
    if (candidates.size === 1) return [...candidates][0];
    const fromFolder = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
    const sameFolder = [...candidates].find((p) => {
      const folder = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      return folder === fromFolder;
    });
    return sameFolder ?? [...candidates].sort()[0];
  }

  /**
   * Normalize a markdown-link href to a vault-relative path STRING (R70) — does
   * NOT consult the index (returns the path even if no file exists there). Decodes
   * `%xx`, drops the `#anchor` / `?query`, resolves `./` `../` against fromPath's
   * folder and a leading `/` against the vault root. Returns null for external
   * schemes (`https:`/`mailto:`/…), protocol-relative `//`, pure anchors, empty,
   * or a `..` that escapes the vault root. Used by resolveMarkdownLink and by the
   * rewrite engine's path-form only-fix-broken check.
   */
  normalizeMdHref(href: string, fromPath: string): string | null {
    let h = href.trim();
    if (h === "" || h.startsWith("#") || h.startsWith("//")) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // external scheme
    h = h.split("#")[0].split("?")[0];
    if (h === "") return null;
    try {
      h = decodeURIComponent(h);
    } catch {
      /* malformed %xx — keep raw */
    }
    // base folder depends ONLY on the prefix (consistent resolution, review R70):
    // `/x` = vault root; `./x` / `../x` = relative to the referrer's folder;
    // everything else = vault-root-relative (matches resolveLink's wikilink rule).
    // The `.`/`..` segment loop then always runs, so `sub/../x.md` and `sub/x.md`
    // resolve under the same base rather than diverging.
    let segs: string[];
    if (h.startsWith("/")) {
      segs = [];
      h = h.slice(1);
    } else if (h.startsWith("./") || h.startsWith("../")) {
      segs = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")).split("/") : [];
    } else {
      segs = [];
    }
    for (const seg of h.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (segs.length === 0) return null; // escaped the vault root
        segs.pop();
        continue;
      }
      segs.push(seg);
    }
    return segs.join("/");
  }

  /**
   * Resolve a markdown-link href to a vault path (R70). Mirrors resolveLink's
   * lenient md-or-attachment resolution but over a normalized markdown href.
   * Returns the resolved vault path or null. NEVER touches resolveLink's frozen
   * signature — markdown's relative/encoded/anchored forms live here.
   */
  resolveMarkdownLink(href: string, fromPath: string): string | null {
    const p = this.normalizeMdHref(href, fromPath);
    if (p === null) return null;
    // A POSITION-bearing href — root-absolute `/x` or explicit-relative `./`/`../`
    // — encodes an exact vault location, so it must resolve by EXACT path, never
    // basename-fuzz to a same-named note in another folder (review R71 major:
    // `/Z.md` from a subfolder was resolving to `subfolder/Z.md`). A bare
    // basename keeps resolveLink's shortest-path/basename behavior.
    const stripped = href.trim().split("#")[0].split("?")[0];
    if (stripped.startsWith("/") || stripped.startsWith("./") || stripped.startsWith("../")) {
      const exactMd = this.lowerPathToPath.get((p.replace(/\.md$/i, "") + ".md").toLowerCase());
      return exactMd ?? this.resolveAttachment(p, fromPath);
    }
    return this.resolveLink(p, fromPath) ?? this.resolveAttachment(p, fromPath);
  }

  /**
   * Resolve a LinkRef to a vault path with the resolver matching its kind (R70):
   * markdown hrefs route through resolveMarkdownLink (decode / strip anchor /
   * relative), wikilinks through resolveLink. EVERY meta.links consumer
   * (backlinks / outgoing links / graph / compat resolvedLinks) must use this —
   * resolving a markdown href with the wikilink resolver drops anchored/encoded/
   * relative md links into the unresolved bucket (review R70: ghost graph nodes,
   * missing backlinks).
   */
  resolveByKind(link: LinkRef, fromPath: string): string | null {
    return link.kind === "markdown"
      ? this.resolveMarkdownLink(link.target, fromPath)
      : this.resolveLink(link.target, fromPath);
  }

  /**
   * Resolve a NON-markdown attachment target ("img.png" / "assets/img.png").
   * Mirrors resolveLink: a target containing "/" tries an exact relative-path
   * match first (case-insensitive); otherwise it matches by basename including
   * extension (multiple hits resolve to the lexicographically first path).
   * Lookup maps are built lazily from vault.getFiles() non-md files and are
   * invalidated whenever the vault tree changes ("vault:changed").
   */
  resolveAttachment(target: string, fromPath: string): string | null {
    void fromPath; // part of the frozen signature; current rules do not use it
    const clean = target.trim();
    if (!clean) return null;
    const maps = this.getAttachmentMaps();
    if (clean.includes("/")) {
      const exact = maps.lowerPathToPath.get(clean.toLowerCase());
      if (exact) return exact;
    }
    const candidates = maps.lowerBasenameToPaths.get(clean.split("/").pop()!.toLowerCase());
    if (!candidates || candidates.length === 0) return null;
    return candidates[0];
  }

  private getAttachmentMaps(): NonNullable<MetadataIndex["attachmentMaps"]> {
    if (this.attachmentMaps) return this.attachmentMaps;
    const lowerPathToPath = new Map<string, string>();
    const lowerBasenameToPaths = new Map<string, string[]>();
    for (const f of this.vault.getFiles()) {
      if (f.extension.toLowerCase() === "md") continue;
      lowerPathToPath.set(f.path.toLowerCase(), f.path);
      const key = f.name.toLowerCase();
      const list = lowerBasenameToPaths.get(key);
      if (list) list.push(f.path);
      else lowerBasenameToPaths.set(key, [f.path]);
    }
    // deterministic "first" pick for duplicate basenames
    for (const list of lowerBasenameToPaths.values()) list.sort();
    this.attachmentMaps = { lowerPathToPath, lowerBasenameToPaths };
    return this.attachmentMaps;
  }

  /** Backlinks: every file that links to `path`, with context snippets. */
  getBacklinks(path: string): BacklinkEntry[] {
    const out: BacklinkEntry[] = [];
    for (const meta of this.byPath.values()) {
      if (meta.path === path) continue;
      const hits = meta.links.filter((l) => this.resolveByKind(l, meta.path) === path);
      if (hits.length === 0) continue;
      out.push({
        sourcePath: meta.path,
        contexts: hits.map((l) => ({
          snippet: l.context ?? "",
          from: l.from,
        })),
      });
    }
    return out.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  }

  /** Outgoing resolved + unresolved links for a file. */
  getOutgoingLinks(path: string): Array<{ link: LinkRef; resolvedPath: string | null }> {
    const meta = this.byPath.get(path);
    if (!meta) return [];
    return meta.links.map((link) => ({ link, resolvedPath: this.resolveByKind(link, path) }));
  }

  /** R65: footnote definitions for a file, in document order. */
  getFootnotes(path: string): FootnoteRef[] {
    return this.byPath.get(path)?.footnotes ?? [];
  }

  /** tag (no '#') -> paths that contain it */
  getTagMap(): Map<string, Set<string>> {
    const rev = this.revision.get();
    if (this.tagMapCache?.rev === rev) return this.tagMapCache.map;
    const map = new Map<string, Set<string>>();
    for (const meta of this.byPath.values()) {
      for (const t of meta.tags) {
        let set = map.get(t.tag);
        if (!set) map.set(t.tag, (set = new Set()));
        set.add(meta.path);
      }
    }
    this.tagMapCache = { rev, map };
    return map;
  }

  /**
   * R22: every frontmatter key used anywhere in the vault — authored casing,
   * case-insensitively deduplicated (first occurrence wins), sorted
   * lexicographically. Lazily computed and cached per index revision.
   */
  getPropertyKeys(): string[] {
    const rev = this.revision.get();
    if (this.propertyKeysCache?.rev === rev) return this.propertyKeysCache.keys;
    const seen = new Map<string, string>(); // lowercased → first-seen casing
    for (const meta of this.byPath.values()) {
      const fields = meta.frontmatter?.fields;
      if (!fields) continue;
      for (const key of Object.keys(fields)) {
        const lower = key.toLowerCase();
        if (!seen.has(lower)) seen.set(lower, key);
      }
    }
    const keys = [...seen.values()].sort();
    this.propertyKeysCache = { rev, keys };
    return keys;
  }

  /**
   * R30: every frontmatter key → number of files that use it. Authored casing
   * (first-seen wins, case-insensitively deduplicated like getPropertyKeys);
   * a file using the same key twice (impossible in a parsed map, but defensive)
   * counts once. Lazily computed and cached per index revision.
   */
  getPropertyKeyCounts(): Map<string, number> {
    const rev = this.revision.get();
    if (this.propertyKeyCountsCache?.rev === rev) return this.propertyKeyCountsCache.counts;
    const casing = new Map<string, string>(); // lowercased → first-seen casing
    const counts = new Map<string, number>(); // authored casing → file count
    for (const meta of this.byPath.values()) {
      const fields = meta.frontmatter?.fields;
      if (!fields) continue;
      const seenInFile = new Set<string>(); // lowercased keys counted in THIS file
      for (const key of Object.keys(fields)) {
        const lower = key.toLowerCase();
        if (seenInFile.has(lower)) continue;
        seenInFile.add(lower);
        let authored = casing.get(lower);
        if (authored === undefined) {
          authored = key;
          casing.set(lower, authored);
        }
        counts.set(authored, (counts.get(authored) ?? 0) + 1);
      }
    }
    this.propertyKeyCountsCache = { rev, counts };
    return counts;
  }

  /**
   * R30: distinct frontmatter VALUES used for `key` anywhere in the vault, for
   * value-suggestion datalists. Key matched case-insensitively; values rendered
   * as authored strings, value-level case-sensitively deduplicated (Obsidian
   *口径), sorted lexicographically. Not cached (per-key, small call surface).
   */
  getPropertyValues(key: string): string[] {
    const lower = key.toLowerCase();
    const seen = new Set<string>();
    for (const meta of this.byPath.values()) {
      const fields = meta.frontmatter?.fields;
      if (!fields) continue;
      for (const k of Object.keys(fields)) {
        if (k.toLowerCase() !== lower) continue;
        const v = fields[k];
        if (Array.isArray(v)) {
          for (const item of v) if (item !== "") seen.add(item);
        } else if (v !== "") {
          seen.add(v);
        }
      }
    }
    return [...seen].sort();
  }

  /** Global graph including unresolved (phantom) nodes. */
  getGraph(): GraphData {
    const t0 = performance.now();
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const edgeSeen = new Set<string>();

    for (const path of this.byPath.keys()) {
      const label = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
      nodes.set(path, { id: path, label, resolved: true, degree: 0 });
    }
    for (const meta of this.byPath.values()) {
      for (const link of meta.links) {
        // graph nodes are notes only (byPath); a markdown link can resolve to an
        // ATTACHMENT (resolveMarkdownLink falls back to resolveAttachment) which
        // has no node — treat any non-note resolution as a ghost, matching how a
        // wikilink-to-attachment already behaves (resolveLink returns null). This
        // also guards the degree++ below from an absent target node.
        const resolvedRaw = this.resolveByKind(link, meta.path);
        const resolved = resolvedRaw !== null && nodes.has(resolvedRaw) ? resolvedRaw : null;
        const targetId = resolved ?? `unresolved:${link.target.toLowerCase()}`;
        if (!resolved && !nodes.has(targetId)) {
          nodes.set(targetId, { id: targetId, label: link.target, resolved: false, degree: 0 });
        }
        const key = `${meta.path}\u0000${targetId}`;
        if (edgeSeen.has(key) || meta.path === targetId) continue;
        edgeSeen.add(key);
        edges.push({ source: meta.path, target: targetId });
      }
    }
    for (const e of edges) {
      nodes.get(e.source)!.degree++;
      nodes.get(e.target)!.degree++;
    }
    perfMark("graphBuildMs", performance.now() - t0);
    return { nodes: [...nodes.values()], edges };
  }
}

/** Stash a perf number on window.__geodePerf (dev/bench inspection only). */
function perfMark(key: string, value: number): void {
  const g = globalThis as unknown as { __geodePerf?: Record<string, number> };
  g.__geodePerf = { ...g.__geodePerf, [key]: Math.round(value * 100) / 100 };
}

function makeSnippet(content: string, from: number, to: number, radius = 60): string {
  const start = Math.max(0, content.lastIndexOf("\n", from) + 1);
  let end = content.indexOf("\n", to);
  if (end === -1) end = content.length;
  let line = content.slice(start, end).trim();
  if (line.length > radius * 2) {
    const center = from - start;
    const s = Math.max(0, center - radius);
    line = (s > 0 ? "…" : "") + line.slice(s, Math.min(line.length, center + radius)) + "…";
  }
  return line;
}
