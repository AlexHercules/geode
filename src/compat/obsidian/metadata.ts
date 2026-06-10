/**
 * Obsidian MetadataCache shim (API-REFERENCE area 3) over Geode's MetadataIndex.
 *
 * - headings WITHOUT '#', tags WITH '#', frontmatter keys keep authored case.
 * - Pos/Loc are 0-based line/col, computed lazily from cached content with
 *   per-(path, revision) caching; falls back to zeroed line/col when the
 *   content is not in the LRU cache (a read is warmed for next time).
 * - resolvedLinks / unresolvedLinks recomputed lazily per index revision.
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

export interface FrontMatterCache {
  [key: string]: unknown;
}

/**
 * embeds / sections / listItems / blocks / frontmatterLinks are NOT produced
 * by Geode's parser yet (all optional fields — recorded gap).
 */
export interface CachedMetadata {
  links?: LinkCache[];
  embeds?: EmbedCache[];
  tags?: TagCache[];
  headings?: HeadingCache[];
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

export class MetadataCache extends Events {
  private cacheByPath = new Map<string, { rev: number; cache: CachedMetadata | null }>();
  private linksRev = -1;
  private _resolved: LinkTable = {};
  private _unresolved: LinkTable = {};

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
    const rev = this.handle.metadata.revision.get();
    const hit = this.cacheByPath.get(path);
    if (hit && hit.rev === rev) return hit.cache;
    const meta = this.handle.metadata.getMetadata(path);
    const cache = meta ? this.buildCache(meta) : null;
    this.cacheByPath.set(path, { rev, cache });
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

  private buildCache(meta: NoteMetadata): CachedMetadata {
    const content = this.handle.vault.readCached(meta.path);
    if (content === undefined) {
      // warm the cache so positions are accurate on the next call
      void this.handle.vault.read(meta.path).catch(() => undefined);
    }
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
    if (meta.links.length > 0) {
      out.links = meta.links.map((l) => ({
        link: l.target,
        original:
          content !== undefined
            ? content.slice(l.from, l.to)
            : `[[${l.target}${l.alias ? `|${l.alias}` : ""}]]`,
        ...(l.alias !== undefined ? { displayText: l.alias } : {}),
        position: pos(l.from, l.to),
      }));
    }
    if (meta.tags.length > 0) {
      out.tags = meta.tags.map((t) => ({
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

  private ensureLinkTables(): void {
    const rev = this.handle.metadata.revision.get();
    if (rev === this.linksRev) return;
    const resolved: LinkTable = {};
    const unresolved: LinkTable = {};
    for (const meta of this.handle.metadata.getAll()) {
      for (const link of meta.links) {
        const dest = this.handle.metadata.resolveLink(link.target, meta.path);
        const table = dest ? resolved : unresolved;
        const key = dest ?? link.target;
        const row = (table[meta.path] ??= {});
        row[key] = (row[key] ?? 0) + 1;
      }
    }
    this._resolved = resolved;
    this._unresolved = unresolved;
    this.linksRev = rev;
  }
}
