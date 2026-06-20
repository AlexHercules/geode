/**
 * Obsidian MetadataCache shim (API-REFERENCE area 3) over Geode's MetadataIndex.
 *
 * - headings WITHOUT '#', tags WITH '#', frontmatter keys keep authored case.
 * - cache.tags contains BODY tag occurrences only — frontmatter tags live in
 *   cache.frontmatter and are merged by getAllTags(), like real Obsidian.
 * - Pos/Loc are 0-based line/col, computed lazily from cached content with
 *   per-file caching (keyed on NoteMetadata identity, so a save invalidates
 *   exactly that file); falls back to zeroed line/col when the content is not
 *   in the LRU cache (a read is warmed for next time, result not cached).
 * - resolvedLinks / unresolvedLinks maintained lazily: dirty source rows are
 *   recomputed incrementally on content modifications; create/delete/rename/
 *   load and alias changes fall back to a full rebuild.
 */
import type { AppHandle } from "@core/plugins";
import type { NoteMetadata } from "@core/types";
import { Events, type EventRef } from "./events";
import type { FileRegistry, TFile } from "./files";

export interface Loc {
  /** Line number. 0-based. */
  line: number;
  /** Column number (0-based). */
  col: number;
  /** Characters from the beginning of the file. */
  offset: number;
}

export interface Pos {
  start: Loc;
  end: Loc;
}

export interface CacheItem {
  position: Pos;
}

export interface Reference {
  link: string;
  original: string;
  displayText?: string;
}

export interface ReferenceCache extends Reference, CacheItem {}
export interface LinkCache extends ReferenceCache {}
export interface EmbedCache extends ReferenceCache {}

/** R126: a `[[wikilink]]` found inside a frontmatter property value. Unlike LinkCache it has
 *  NO position (Obsidian identifies it by `key`, the property path); `key` is the field name,
 *  or `field.N` for the Nth element of a list-valued property. */
export interface FrontmatterLinkCache extends Reference {
  key: string;
}

export interface TagCache extends CacheItem {
  /** Includes the leading '#'. */
  tag: string;
}

export interface HeadingCache extends CacheItem {
  /** Heading text only — '#' markers stripped. */
  heading: string;
  /** Number between 1 and 6. */
  level: number;
}

export interface BlockCache extends CacheItem {
  /** Block id WITHOUT the leading '^'. */
  id: string;
}

/** R127: a `[^id]: content` footnote DEFINITION. */
export interface FootnoteCache extends CacheItem {
  /** footnote id WITHOUT the leading '^'. */
  id: string;
}

/** R127: an inline `[^id]` footnote REFERENCE in the body. */
export interface FootnoteRefCache extends CacheItem {
  /** footnote id WITHOUT the leading '^'. */
  id: string;
}

export interface FrontMatterCache {
  [key: string]: unknown;
}

export interface SectionCache extends CacheItem {
  /** Block id of this section (without the leading '^'), if it carries one. */
  id?: string;
  /** Parser-generated type. Geode produces a TOP-LEVEL block segmentation:
   *  yaml / heading / code / blockquote / list / table / html / thematicBreak /
   *  paragraph. Obsidian's typing is explicitly non-exhaustive; Geode classifies
   *  each block by its first line, not a full CommonMark parse. */
  type: string;
}

export interface ListItemCache extends CacheItem {
  /** Block id of this list item (without the leading '^'), if it carries one. */
  id?: string;
  /** Parent list item's line number (position.start.line). A ROOT item (no parent)
   *  carries the NEGATIVE line number of the list's first item (Obsidian encoding). */
  parent: number;
  /** The char inside `[ ]` for a task item (' ' = incomplete, any other = done);
   *  undefined when the item is not a task. */
  task?: string;
}

/**
 * embeds is real since R119 (`![[..]]` wikilink embeds, split out of links).
 * sections is real since R124 (top-level block segmentation, see buildSections) and
 * listItems since R125 (see buildListItems). frontmatterLinks is real since R126
 * (`[[wikilink]]` inside property values, see buildFrontmatterLinks). footnotes +
 * footnoteRefs are real since R127 (core parseNote: `[^id]:` definitions + `[^id]`
 * references). blocks is real since R13 (`^id`, core parseNote).
 */
export interface CachedMetadata {
  links?: LinkCache[];
  embeds?: EmbedCache[];
  tags?: TagCache[];
  headings?: HeadingCache[];
  /** id (without '^') -> block cache; omitted when the note has no blocks. */
  blocks?: Record<string, BlockCache>;
  sections?: SectionCache[];
  listItems?: ListItemCache[];
  /** `[^id]: content` footnote definitions. */
  footnotes?: FootnoteCache[];
  /** inline `[^id]` footnote references in the body. */
  footnoteRefs?: FootnoteRefCache[];
  frontmatter?: FrontMatterCache;
  frontmatterPosition?: Pos;
  frontmatterLinks?: FrontmatterLinkCache[];
}

type Handle = Omit<AppHandle, "ui">;
type LinkTable = Record<string, Record<string, number>>;

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToLoc(offset: number, starts: number[] | null): Loc {
  if (!starts) return { line: 0, col: 0, offset };
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: offset - starts[lo], offset };
}

/* R124: top-level block classification by the block's FIRST line (Obsidian's section typing
 * is explicitly non-exhaustive — Geode segments at the top level, not a full CommonMark parse). */
const SEC_HEADING = /^#{1,6}\s/;
const SEC_THEMATIC = /^ {0,3}([-*_])[ \t]*(\1[ \t]*){2,}$/;
const SEC_BLOCKQUOTE = /^ {0,3}>/;
const SEC_LIST = /^ {0,3}([-*+][ \t]|\d{1,9}[.)][ \t])/;
const SEC_HTML = /^ {0,3}</;
const SEC_FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const SEC_TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?([ \t]*\|[ \t]*:?-+:?)*[ \t]*\|?[ \t]*$/;

// classifies the BLANK-LINE-delimited blocks; heading / thematicBreak are NOT here — they are
// single-line blocks handled inline by buildSections (so they break a block even with no blank line)
function classifySection(firstLine: string, blockText: string): string {
  if (SEC_BLOCKQUOTE.test(firstLine)) return "blockquote";
  if (SEC_LIST.test(firstLine)) return "list";
  if (SEC_HTML.test(firstLine)) return "html";
  if (firstLine.includes("|")) {
    const second = blockText.split("\n", 2)[1];
    if (second !== undefined && SEC_TABLE_SEP.test(second)) return "table";
  }
  return "paragraph";
}

interface SegLine {
  start: number;
  end: number;
  text: string;
}

/** Split `content` into lines: each = [start, end) excluding the trailing newline. Line `i`
 *  of the array is line `i` (0-based, matching Pos.line). Shared by buildSections/buildListItems. */
function splitLines(content: string): SegLine[] {
  const lines: SegLine[] = [];
  for (let p = 0; p <= content.length; ) {
    let nl = content.indexOf("\n", p);
    if (nl === -1) nl = content.length;
    lines.push({ start: p, end: nl, text: content.slice(p, nl) });
    if (nl === content.length) break;
    p = nl + 1;
  }
  return lines;
}

/** A list-item line at ANY indent: captures (1) leading whitespace and (2) the task char inside
 *  `[ ]`, if any. Distinct from SEC_LIST (≤3-indent, for top-level block typing) — nested items
 *  are more-indented, so listItems must accept any indent. */
const LIST_ITEM_RE = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[(.)\][ \t])?/;
// trailing `^id` on a list item's own line — mirrors core BLOCK_MARKER_RE charset (R125)
const LIST_ITEM_ID_RE = /\s\^([A-Za-z0-9-]+)\s*$/;

/**
 * R125: every list item → a ListItemCache. A list runs from its first item until a non-blank,
 * NON-indented, non-item line (blank lines and indented continuation lines keep the list open —
 * a top-level approximation, like sections). `parent` is the line number of the immediate parent
 * item (resolved by an indent stack); a ROOT item carries the NEGATIVE line of the list's first
 * item (Obsidian encoding). `task` is the `[ ]` char; `id` comes from a trailing `^id` on the
 * item's own line. `position` is the item's single line (a top-level approximation — Obsidian's
 * CommonMark node would span the item's whole subtree; consumers like Tasks read only start.line).
 */
function buildListItems(
  content: string,
  fmEnd: number,
  pos: (from: number, to: number) => Pos,
): ListItemCache[] {
  const items: ListItemCache[] = [];
  const lines = splitLines(content);
  // a `- x` inside a fenced code block is NOT a list item — record each fenced line's OPENING
  // indent (−1 = not fenced; mirrors buildSections' fence detection). A column-0 fence later breaks
  // the list like a paragraph; an indented one is a list item's own code block (R125 review).
  const fenceIndent = new Array<number>(lines.length).fill(-1);
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].text.match(SEC_FENCE_OPEN);
    if (!open) continue;
    const openIndent = open[0].length - open[1].length; // leading spaces before the ```/~~~ run
    const close = new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}[ \\t]*$`);
    let j = i;
    for (; j < lines.length; j++) { fenceIndent[j] = openIndent; if (j > i && close.test(lines[j].text)) break; }
    i = j;
  }
  for (let i = 0; i < lines.length; ) {
    // skip frontmatter (a YAML `  - a` entry is not a document list item) and fenced lines
    if (lines[i].start < fmEnd || fenceIndent[i] >= 0 || !LIST_ITEM_RE.test(lines[i].text)) { i++; continue; }
    const firstLine = i; // 0-based line number of the list's first item
    const stack: Array<{ indent: number; line: number }> = []; // ancestor items
    for (; i < lines.length; i++) {
      // a column-0 fence ends the list (top-level code block); an indented one is the current
      // item's own code block and keeps the list open
      if (fenceIndent[i] >= 0) { if (fenceIndent[i] === 0) break; continue; }
      const ln = lines[i];
      if (ln.text.trim() === "") continue; // blank line keeps a (loose) list open
      const m = LIST_ITEM_RE.exec(ln.text);
      if (!m) {
        if (/^[ \t]/.test(ln.text)) continue; // indented continuation line of the current item
        break; // a non-indented non-item line ends the list
      }
      const indent = m[1].length;
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      const item: ListItemCache = {
        position: pos(ln.start, ln.end),
        parent: stack.length > 0 ? stack[stack.length - 1].line : -firstLine,
      };
      if (m[2] !== undefined) item.task = m[2];
      // id comes straight from a trailing `^id` on THIS line: core's block run spans contiguous
      // siblings so its block.to lands on the last sibling, not the anchored item (R125 review)
      const idM = LIST_ITEM_ID_RE.exec(ln.text);
      if (idM) item.id = idM[1];
      items.push(item);
      stack.push({ indent, line: i });
    }
  }
  return items;
}

// `[[target#sub|alias]]` inside a frontmatter value — mirrors core WIKILINK_RE (target excludes the
// `#subpath`, so frontmatterLinks.link matches how body LinkCache.link is reported, R126).
const FM_WIKILINK_RE = /\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|([^[\]]*))?\]\]/g;

/**
 * R126: scan parsed frontmatter `fields` for `[[wikilinks]]` → FrontmatterLinkCache[]. A string
 * value is scanned under its own key; a list value's Nth element under `key.N` (Obsidian encoding).
 * `link` = target (no subpath, trimmed), `original` = the written `[[..]]`, `displayText` = the
 * `|alias` if any. Needs no content (only the parsed fields) so it survives the no-content transient.
 * Note: core's frontmatter parser only yields string | string[] values, and an UNQUOTED `k: [[X]]`
 * is mis-read as an inline list by core upstream — the canonical quoted `k: "[[X]]"` works.
 */
function buildFrontmatterLinks(fields: Record<string, string | string[]>): FrontmatterLinkCache[] {
  const out: FrontmatterLinkCache[] = [];
  const scan = (text: string, key: string): void => {
    for (const m of text.matchAll(FM_WIKILINK_RE)) {
      const target = m[1].trim();
      if (target === "") continue;
      const alias = m[2]?.trim() || undefined;
      out.push({
        key,
        link: target,
        original: m[0],
        ...(alias !== undefined ? { displayText: alias } : {}),
      });
    }
  };
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") scan(value, key);
    else for (let i = 0; i < value.length; i++) scan(value[i], `${key}.${i}`);
  }
  return out;
}

/**
 * R124: segment `content` into top-level SectionCache blocks. Frontmatter → one `yaml` section;
 * fenced code (``` / ~~~) is an ATOMIC `code` block (its internal blank lines never split it);
 * everything else is split into blocks by blank lines and classified by its first line. A section
 * inherits a block id when a `^id` anchor (from meta.blocks) falls inside its range.
 */
function buildSections(
  content: string,
  fmEnd: number,
  blocks: readonly { id: string; from: number }[],
  pos: (from: number, to: number) => Pos,
): SectionCache[] {
  const secs: SectionCache[] = [];
  const push = (type: string, from: number, to: number): void => {
    if (content.slice(from, to).trim() === "") return;
    const sec: SectionCache = { type, position: pos(from, to) };
    const blk = blocks.find((b) => b.from >= from && b.from < to);
    if (blk) sec.id = blk.id;
    secs.push(sec);
  };
  if (fmEnd > 0) push("yaml", 0, fmEnd);

  const lines = splitLines(content);
  let bStart = -1;
  let bEnd = -1;
  let bFirst = "";
  const flush = (): void => {
    if (bStart < 0) return;
    push(classifySection(bFirst, content.slice(bStart, bEnd)), bStart, bEnd);
    bStart = -1;
  };
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    if (ln.start < fmEnd) continue; // inside the frontmatter block
    const open = ln.text.match(SEC_FENCE_OPEN);
    if (open) {
      flush();
      const marker = open[1]; // run of ` or ~
      const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
      let end = ln.end;
      let lj = li + 1;
      for (; lj < lines.length; lj++) {
        end = lines[lj].end;
        if (close.test(lines[lj].text)) break;
      }
      push("code", ln.start, end);
      li = lj;
      continue;
    }
    // R124 review (D1): an ATX heading / thematic break is its own SINGLE-line block even with no
    // blank line around it (Obsidian behavior), so it always breaks the current paragraph block
    if (SEC_HEADING.test(ln.text)) { flush(); push("heading", ln.start, ln.end); continue; }
    if (SEC_THEMATIC.test(ln.text)) { flush(); push("thematicBreak", ln.start, ln.end); continue; }
    if (ln.text.trim() === "") { flush(); continue; }
    if (bStart < 0) { bStart = ln.start; bFirst = ln.text; }
    bEnd = ln.end;
  }
  flush();
  secs.sort((a, b) => a.position.start.offset - b.position.start.offset);
  return secs;
}

/** Aliases are the only modify-mutable input that can flip OTHER files' link resolution. */
function aliasSignature(meta: NoteMetadata): string {
  return meta.aliases.join("\n");
}

export class MetadataCache extends Events {
  /**
   * Per-file cache keyed on NoteMetadata object identity — MetadataIndex
   * creates a fresh NoteMetadata per reparse, so saving file A invalidates
   * exactly A's entry; deleted/renamed paths fall out via GC.
   */
  private cacheByMeta = new WeakMap<NoteMetadata, CachedMetadata>();
  private linksRev = -1;
  private _resolved: LinkTable = {};
  private _unresolved: LinkTable = {};
  /**
   * Link-table dirty tracking: source path -> the meta object + alias
   * signature captured BEFORE the reindex. An entry is consumed only once its
   * meta identity has changed (the reindex landed); until then it stays
   * pending across syncs, so a bump caused by another file cannot swallow it.
   */
  private dirtyLinkSources = new Map<
    string,
    { prevMeta: NoteMetadata | undefined; prevSig: string | null }
  >();
  /** create/delete/rename/load — anything that can flip other files' rows */
  private linksNeedFullRebuild = false;

  constructor(
    private handle: Handle,
    private registry: FileRegistry,
  ) {
    super();
  }

  /** 'Contains all resolved links' — Record<srcPath, Record<destPath, count>>. */
  get resolvedLinks(): LinkTable {
    this.ensureLinkTables();
    return this._resolved;
  }

  /** Inner keys are the raw unresolved linktexts as written. */
  get unresolvedLinks(): LinkTable {
    this.ensureLinkTables();
    return this._unresolved;
  }

  getFileCache(file: TFile): CachedMetadata | null {
    return this.getCache(file.path);
  }

  getCache(path: string): CachedMetadata | null {
    const meta = this.handle.metadata.getMetadata(path);
    if (!meta) return null;
    const hit = this.cacheByMeta.get(meta);
    if (hit) return hit;
    const content = this.handle.vault.readCached(path);
    if (content === undefined) {
      // warm the cache so positions are accurate on the next call
      void this.handle.vault.read(path).catch(() => undefined);
    }
    const cache = this.buildCache(meta, content);
    // zero-position results built without content are NOT cached, so positions
    // heal on the next call once the warm-up read has landed
    if (content !== undefined) this.cacheByMeta.set(meta, cache);
    return cache;
  }

  /** 'Get the best match for a linkpath.' */
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    const clean = linkpath.split("#")[0].trim();
    if (!clean) return null;
    const resolved = this.handle.metadata.resolveLink(clean, sourcePath);
    return resolved ? this.registry.getFile(resolved) : null;
  }

  /** 'If file name is unique, use the filename. If not unique, use full path.' */
  fileToLinktext(file: TFile, _sourcePath: string, omitMdExtension?: boolean): string {
    const omit = omitMdExtension !== false && file.extension === "md";
    const sameName = this.handle.vault
      .getFiles()
      .filter((f) => f.basename.toLowerCase() === file.basename.toLowerCase());
    if (sameName.length <= 1) return omit ? file.basename : file.name;
    return omit ? file.path.replace(/\.md$/i, "") : file.path;
  }

  /**
   * R114: 'Get all tags in the vault, with the count of how many notes use each.'
   * Keys carry the leading `#` (Obsidian convention); the count is the number of
   * DISTINCT notes containing the tag — Obsidian aggregates getAllTags() per file
   * (unique-per-file), so notes-containing matches its count. Reuses the core tag
   * map (cached per index revision). Geode indexes tags case-sensitively, so
   * `#Tag` / `#tag` are distinct keys (minor divergence if a vault mixes casing).
   * The `#` prefix also keeps a literal `__proto__` tag a safe own key.
   */
  getTags(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [tag, paths] of this.handle.metadata.getTagMap()) {
      out[`#${tag}`] = paths.size;
    }
    return out;
  }

  /* ----- typed event overloads ----- */

  on(
    name: "changed",
    callback: (file: TFile, data: string, cache: CachedMetadata) => unknown,
    ctx?: unknown,
  ): EventRef;
  on(
    name: "deleted",
    callback: (file: TFile, prevCache: CachedMetadata | null) => unknown,
    ctx?: unknown,
  ): EventRef;
  on(name: "resolve", callback: (file: TFile) => unknown, ctx?: unknown): EventRef;
  on(name: "resolved", callback: () => unknown, ctx?: unknown): EventRef;
  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef;
  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef {
    return super.on(name, callback, ctx);
  }

  /* ----- internals ----- */

  private buildCache(meta: NoteMetadata, content: string | undefined): CachedMetadata {
    const starts = content !== undefined ? lineStarts(content) : null;
    const pos = (from: number, to: number): Pos => ({
      start: offsetToLoc(from, starts),
      end: offsetToLoc(to, starts),
    });
    const lineEnd = (from: number, fallbackLen: number): number => {
      if (content === undefined) return from + fallbackLen;
      const nl = content.indexOf("\n", from);
      return nl === -1 ? content.length : nl;
    };

    const out: CachedMetadata = {};
    if (meta.headings.length > 0) {
      out.headings = meta.headings.map((h) => ({
        heading: h.text,
        level: h.level,
        position: pos(h.from, lineEnd(h.from, h.level + 1 + h.text.length)),
      }));
    }
    // R13: ^block markers — official Record shape (assignment order makes
    // duplicate ids last-wins, matching Obsidian's Record semantics); omitted
    // when empty, following the headings/links/tags convention above
    if (meta.blocks.length > 0) {
      const blocks: Record<string, BlockCache> = {};
      for (const b of meta.blocks) {
        blocks[b.id] = { id: b.id, position: pos(b.from, b.to) };
      }
      out.blocks = blocks;
    }
    // R127: footnote definitions + inline references, projected straight from core meta
    // (offsets already resolved by parseNote) — no `content` needed, so they survive the
    // no-content warm-up transient, like frontmatterLinks.
    if (meta.footnotes.length > 0) {
      out.footnotes = meta.footnotes.map((f) => ({ id: f.id, position: pos(f.from, f.to) }));
    }
    if (meta.footnoteRefs.length > 0) {
      out.footnoteRefs = meta.footnoteRefs.map((r) => ({ id: r.id, position: pos(r.from, r.to) }));
    }
    if (meta.links.length > 0) {
      // R119: split `![[..]]` embeds out of links (Obsidian files them separately).
      // Core's WIKILINK_RE matches the inner `[[..]]` (l.from points at `[[`), so an
      // embed's `!` sits at l.from-1; include it in the embed's original/position.
      // When content is undefined (pre-warm transient, NOT cached) embeds can't be
      // detected → everything stays in links; the next call heals once content lands.
      const links: LinkCache[] = [];
      const embeds: EmbedCache[] = [];
      for (const l of meta.links) {
        const isEmbed =
          l.kind === "wikilink" && content !== undefined && l.from > 0 && content[l.from - 1] === "!";
        const from = isEmbed ? l.from - 1 : l.from;
        (isEmbed ? embeds : links).push({
          link: l.target,
          // R70: the no-content fallback must reconstruct the link in its OWN
          // syntax — a markdown link `[text](href)` is not `[[href]]`.
          original:
            content !== undefined
              ? content.slice(from, l.to)
              : l.kind === "markdown"
                ? `[${l.alias ?? ""}](${l.target})`
                : `[[${l.target}${l.alias ? `|${l.alias}` : ""}]]`,
          ...(l.alias !== undefined ? { displayText: l.alias } : {}),
          position: pos(from, l.to),
        });
      }
      if (links.length > 0) out.links = links;
      if (embeds.length > 0) out.embeds = embeds;
    }
    // frontmatter-sourced tag refs (parseNote pushes them with from: 0) are
    // excluded: real Obsidian keeps cache.tags body-only and merges
    // frontmatter tags via getAllTags(). parseNote masks the frontmatter
    // region before tag matching, so genuine body tags always start >= fm.to.
    const fmEnd = meta.frontmatter?.to ?? 0;
    const bodyTags = meta.tags.filter((t) => t.from >= fmEnd);
    if (bodyTags.length > 0) {
      out.tags = bodyTags.map((t) => ({
        tag: `#${t.tag}`,
        position: pos(t.from, t.from + t.tag.length + 1),
      }));
    }
    if (meta.frontmatter) {
      out.frontmatter = { ...meta.frontmatter.fields };
      out.frontmatterPosition = pos(meta.frontmatter.from, meta.frontmatter.to);
      const fmLinks = buildFrontmatterLinks(meta.frontmatter.fields);
      if (fmLinks.length > 0) out.frontmatterLinks = fmLinks;
    }
    // R124/R125: top-level block segmentation + list items (need the real text; the no-content
    // warm-up transient — not cached — simply omits them and heals on the next call)
    if (content !== undefined) {
      const sections = buildSections(content, fmEnd, meta.blocks, pos);
      if (sections.length > 0) out.sections = sections;
      const listItems = buildListItems(content, fmEnd, pos);
      if (listItems.length > 0) out.listItems = listItems;
    }
    return out;
  }

  /**
   * @internal Mark a source file's link rows stale (saved content
   * modification). Captures the pre-reindex meta + alias signature; alias
   * changes (which can flip resolution of OTHER files' links) force a full
   * rebuild when the reindex lands.
   */
  _markLinkSourceDirty(path: string): void {
    if (!this.dirtyLinkSources.has(path)) {
      const prev = this.handle.metadata.getMetadata(path);
      this.dirtyLinkSources.set(path, {
        prevMeta: prev,
        prevSig: prev ? aliasSignature(prev) : null,
      });
    }
  }

  /** @internal Force a full link-table rebuild (create/delete/rename/load). */
  _invalidateLinkTables(): void {
    this.linksNeedFullRebuild = true;
  }

  private ensureLinkTables(): void {
    const rev = this.handle.metadata.revision.get();
    if (rev === this.linksRev) return;

    // partition dirty entries: landed (meta identity changed since the mark)
    // vs still pending (reindex not finished — keep for a later bump)
    const landed: string[] = [];
    let needFull = this.linksNeedFullRebuild || this.linksRev === -1;
    for (const [path, prev] of this.dirtyLinkSources) {
      const meta = this.handle.metadata.getMetadata(path);
      if (meta === prev.prevMeta) {
        // both undefined => nothing to apply; drop instead of pending forever
        if (meta === undefined) landed.push(path);
        continue;
      }
      landed.push(path);
      // changed aliases/name contribution can flip OTHER files' rows
      if (!needFull && (meta ? aliasSignature(meta) : null) !== prev.prevSig) {
        needFull = true;
      }
    }

    if (needFull) {
      const resolved: LinkTable = {};
      const unresolved: LinkTable = {};
      for (const meta of this.handle.metadata.getAll()) {
        this.addLinkRows(meta, resolved, unresolved);
      }
      this._resolved = resolved;
      this._unresolved = unresolved;
      this.linksNeedFullRebuild = false;
    } else {
      // incremental: recompute only the landed source rows — O(changed files)
      for (const path of landed) {
        delete this._resolved[path];
        delete this._unresolved[path];
        const meta = this.handle.metadata.getMetadata(path);
        if (meta) this.addLinkRows(meta, this._resolved, this._unresolved);
      }
    }
    for (const path of landed) this.dirtyLinkSources.delete(path);
    this.linksRev = rev;
  }

  private addLinkRows(meta: NoteMetadata, resolved: LinkTable, unresolved: LinkTable): void {
    for (const link of meta.links) {
      // R70: route by kind so markdown hrefs (anchored / encoded / relative)
      // land in resolvedLinks, not unresolvedLinks (plugin-visible API).
      const dest = this.handle.metadata.resolveByKind(link, meta.path);
      const table = dest ? resolved : unresolved;
      const key = dest ?? link.target;
      const row = (table[meta.path] ??= {});
      row[key] = (row[key] ?? 0) + 1;
    }
  }
}
