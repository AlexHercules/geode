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

export interface FrontMatterCache {
  [key: string]: unknown;
}

/**
 * embeds / sections / listItems / frontmatterLinks are NOT produced by
 * Geode's parser yet (all optional fields — recorded gap). blocks is real
 * since R13 (`^id` markers indexed by core's parseNote).
 */
export interface CachedMetadata {
  links?: LinkCache[];
  embeds?: EmbedCache[];
  tags?: TagCache[];
  headings?: HeadingCache[];
  /** id (without '^') -> block cache; omitted when the note has no blocks. */
  blocks?: Record<string, BlockCache>;
  frontmatter?: FrontMatterCache;
  frontmatterPosition?: Pos;
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
    if (meta.links.length > 0) {
      out.links = meta.links.map((l) => ({
        link: l.target,
        // R70: the no-content fallback must reconstruct the link in its OWN
        // syntax — a markdown link `[text](href)` is not `[[href]]`.
        original:
          content !== undefined
            ? content.slice(l.from, l.to)
            : l.kind === "markdown"
              ? `[${l.alias ?? ""}](${l.target})`
              : `[[${l.target}${l.alias ? `|${l.alias}` : ""}]]`,
        ...(l.alias !== undefined ? { displayText: l.alias } : {}),
        position: pos(l.from, l.to),
      }));
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
