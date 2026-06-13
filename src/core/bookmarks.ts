/**
 * Bookmarks (R27) — Obsidian-compatible `.obsidian/bookmarks.json` store.
 *
 * Persists to `<vault>/.obsidian/bookmarks.json` — the SAME file Obsidian's
 * core Bookmarks plugin reads/writes. Data-safety is the top priority here
 * (this writes user `.obsidian/` data): serialized read-modify-write queue,
 * preserve unknown top-level keys + per-item unknown fields (`_extra`), abort
 * on malformed JSON rather than overwriting Obsidian's data, vault-switch
 * guard. Mirrors the discipline in `core/properties.ts` (types.json RMW).
 *
 * Contract frozen in docs/ARCHITECTURE.md "Round 27 additions".
 */
import { Store } from "./store";
import type { Vault } from "./vault";

export type BookmarkType =
  | "file"
  | "folder"
  | "heading"
  | "block"
  | "search"
  | "graph"
  | "group";

interface BookmarkBase {
  /** ms epoch, written by Obsidian; new items get a caller-supplied value. */
  ctime?: number;
  /** optional custom display title */
  title?: string;
  /** fidelity: raw keys this model does not cover, re-spread on serialize */
  _extra?: Record<string, unknown>;
}
export interface FileBookmark extends BookmarkBase {
  type: "file";
  path: string;
}
export interface FolderBookmark extends BookmarkBase {
  type: "folder";
  path: string;
}
export interface HeadingBookmark extends BookmarkBase {
  type: "heading";
  path: string;
  /** "#Heading" */
  subpath: string;
}
export interface BlockBookmark extends BookmarkBase {
  type: "block";
  path: string;
  /** "#^blockId" */
  subpath: string;
}
export interface SearchBookmark extends BookmarkBase {
  type: "search";
  query: string;
}
export interface GraphBookmark extends BookmarkBase {
  type: "graph";
}
export interface GroupBookmark extends BookmarkBase {
  type: "group";
  items: BookmarkItem[];
}
export type BookmarkItem =
  | FileBookmark
  | FolderBookmark
  | HeadingBookmark
  | BlockBookmark
  | SearchBookmark
  | GraphBookmark
  | GroupBookmark;

export interface BookmarksApi {
  readonly items: Store<ReadonlyArray<BookmarkItem>>;
  init(vault: Vault): Promise<void>;
  isFileBookmarked(path: string): boolean;
  add(item: BookmarkItem, groupPath?: ReadonlyArray<number>): Promise<void>;
  toggleFile(path: string): Promise<void>;
  removeAt(path: ReadonlyArray<number>): Promise<void>;
  setTitleAt(path: ReadonlyArray<number>, title: string): Promise<void>;
  addGroup(title: string, groupPath?: ReadonlyArray<number>): Promise<void>;
  move(
    from: ReadonlyArray<number>,
    toGroup: ReadonlyArray<number>,
    toIndex: number,
  ): Promise<void>;
}

const BOOKMARKS_CONFIG = "bookmarks.json";

const itemsStore = new Store<ReadonlyArray<BookmarkItem>>([]);

let regVault: Vault | null = null;
let regWarnedOnce = false;

/** Every mutation (init + each persist RMW) is serialized on one module
 *  promise chain (properties.ts/themes.ts precedent) so writes never
 *  interleave and a re-init can never race a running write. */
let regChain: Promise<void> = Promise.resolve();

function regEnqueue(label: string, op: () => Promise<void> | void): Promise<void> {
  const run = regChain.then(async () => {
    try {
      await op();
    } catch (err) {
      console.warn(`[bookmarks] ${label} failed`, err);
    }
  });
  regChain = run;
  return run;
}

function regWarn(message: string, err?: unknown): void {
  if (regWarnedOnce) return;
  regWarnedOnce = true;
  if (err !== undefined) console.warn(`[bookmarks] ${message}`, err);
  else console.warn(`[bookmarks] ${message}`);
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "file",
  "folder",
  "heading",
  "block",
  "search",
  "graph",
  "group",
]);

/** Per-type canonical keys — everything else goes into `_extra`. `type`,
 *  `ctime`, `title` are common to all; these are the type-discriminant ones. */
function canonicalKeysFor(type: string): ReadonlySet<string> {
  switch (type) {
    case "file":
    case "folder":
      return new Set(["type", "ctime", "title", "path"]);
    case "heading":
    case "block":
      return new Set(["type", "ctime", "title", "path", "subpath"]);
    case "search":
      return new Set(["type", "ctime", "title", "query"]);
    case "graph":
      return new Set(["type", "ctime", "title"]);
    case "group":
      return new Set(["type", "ctime", "title", "items"]);
    default:
      return new Set(["type", "ctime", "title"]);
  }
}

/** A passthrough carrier for objects whose `type` is a string we don't model.
 *  Modeled as a GraphBookmark-shaped record so the union stays closed, but the
 *  real type string + every original field live in `_extra` and are restored
 *  verbatim on serialize. (We never construct these ourselves; only parse.) */
const UNKNOWN_TYPE_MARKER = "__geode_unknown_type__";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Collect non-canonical own keys of `raw` into a plain object (or undefined
 *  if there are none). `items` is never copied into `_extra` (handled by
 *  recursion); the caller passes the canonical key set. */
function collectExtra(
  raw: Record<string, unknown>,
  canonical: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  let extra: Record<string, unknown> | undefined;
  for (const k of Object.keys(raw)) {
    if (canonical.has(k)) continue;
    (extra ??= {})[k] = raw[k];
  }
  return extra;
}

/** Parse one raw JSON value into a BookmarkItem, or null to drop it (only when
 *  it is not even a plain object). Unknown `type` strings are preserved
 *  losslessly via the UNKNOWN_TYPE_MARKER carrier (whole object kept in
 *  `_extra`, including its real `type`). */
function parseItem(raw: unknown): BookmarkItem | null {
  if (!isPlainObject(raw)) return null;
  const type = raw.type;
  if (typeof type !== "string") {
    // No usable type — keep the whole object so a write round-trips it.
    return {
      type: UNKNOWN_TYPE_MARKER as "graph",
      _extra: { ...raw },
    } as unknown as BookmarkItem;
  }
  if (!KNOWN_TYPES.has(type)) {
    // Known to be foreign: carry every field (incl. real `type`) in `_extra`.
    return {
      type: UNKNOWN_TYPE_MARKER as "graph",
      _extra: { ...raw },
    } as unknown as BookmarkItem;
  }

  const canonical = canonicalKeysFor(type);
  const extra = collectExtra(raw, canonical);
  const base: BookmarkBase = {};
  if (typeof raw.ctime === "number") base.ctime = raw.ctime;
  if (typeof raw.title === "string") base.title = raw.title;
  if (extra) base._extra = extra;

  switch (type) {
    case "file":
      return { ...base, type: "file", path: String(raw.path ?? "") };
    case "folder":
      return { ...base, type: "folder", path: String(raw.path ?? "") };
    case "heading":
      return {
        ...base,
        type: "heading",
        path: String(raw.path ?? ""),
        subpath: String(raw.subpath ?? ""),
      };
    case "block":
      return {
        ...base,
        type: "block",
        path: String(raw.path ?? ""),
        subpath: String(raw.subpath ?? ""),
      };
    case "search":
      return { ...base, type: "search", query: String(raw.query ?? "") };
    case "graph":
      return { ...base, type: "graph" };
    case "group": {
      const items = Array.isArray(raw.items) ? parseItems(raw.items) : [];
      return { ...base, type: "group", items };
    }
    default:
      // unreachable (guarded by KNOWN_TYPES) but keeps TS exhaustive
      return { ...base, type: "graph" };
  }
}

function parseItems(raw: unknown): BookmarkItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BookmarkItem[] = [];
  for (const r of raw) {
    const item = parseItem(r);
    if (item) out.push(item);
  }
  return out;
}

/** Serialize one BookmarkItem back to a plain JSON object: spread `_extra`
 *  first, then canonical fields overwrite. Omits undefined fields. Recurses
 *  into groups. Unknown-type carriers re-emit their original object verbatim. */
function serializeItem(item: BookmarkItem): Record<string, unknown> {
  const extra = item._extra;
  if ((item.type as string) === UNKNOWN_TYPE_MARKER) {
    // Carrier: the entire original object lives in _extra — restore it
    // verbatim, but overlay a title/ctime if the user edited one (e.g. Rename
    // on a foreign-type bookmark): the carrier itself holds those fields and
    // they must not be lost on write.
    const out: Record<string, unknown> = { ...(extra ?? {}) };
    if (item.title !== undefined) out.title = item.title;
    if (item.ctime !== undefined) out.ctime = item.ctime;
    return out;
  }

  const out: Record<string, unknown> = { ...(extra ?? {}) };
  out.type = item.type;
  if (item.ctime !== undefined) out.ctime = item.ctime;
  else delete out.ctime;
  if (item.title !== undefined) out.title = item.title;
  else delete out.title;

  switch (item.type) {
    case "file":
    case "folder":
      out.path = item.path;
      break;
    case "heading":
    case "block":
      out.path = item.path;
      out.subpath = item.subpath;
      break;
    case "search":
      out.query = item.query;
      break;
    case "graph":
      break;
    case "group":
      out.items = item.items.map(serializeItem);
      break;
  }
  return out;
}

function serializeItems(items: ReadonlyArray<BookmarkItem>): Record<string, unknown>[] {
  return items.map(serializeItem);
}

/* ---------------- immutable index-path helpers ---------------- */

/** Resolve the GroupBookmark addressed by an index path, or null for top-level
 *  ([] / undefined) or if the path does not lead to a group. */
function getGroupAt(
  items: ReadonlyArray<BookmarkItem>,
  groupPath: ReadonlyArray<number> | undefined,
): GroupBookmark | null {
  if (!groupPath || groupPath.length === 0) return null;
  let cur: BookmarkItem | undefined = items[groupPath[0]];
  for (let i = 1; i < groupPath.length; i++) {
    if (!cur || cur.type !== "group") return null;
    cur = cur.items[groupPath[i]];
  }
  if (!cur || cur.type !== "group") return null;
  return cur;
}

/** Return a new tree with `item` appended (or spliced at `at`) into the array
 *  addressed by `groupPath` ([] / undefined = top level). Clones only the path
 *  down to the mutation point (rest of the tree is shared, immutable). */
function insertInto(
  items: ReadonlyArray<BookmarkItem>,
  groupPath: ReadonlyArray<number> | undefined,
  item: BookmarkItem,
  at?: number,
): BookmarkItem[] {
  if (!groupPath || groupPath.length === 0) {
    const next = items.slice();
    const idx = at === undefined ? next.length : clampIndex(at, next.length);
    next.splice(idx, 0, item);
    return next;
  }
  const idx = groupPath[0];
  const next = items.slice();
  const target = next[idx];
  if (!target || target.type !== "group") return next; // path invalid: no-op
  const childPath = groupPath.slice(1);
  const newItems = insertInto(target.items, childPath, item, at);
  next[idx] = { ...target, items: newItems };
  return next;
}

/** Return a new tree with the item at `path` removed. No-op (returns a shallow
 *  clone) if the path is invalid. */
function removeAtPath(
  items: ReadonlyArray<BookmarkItem>,
  path: ReadonlyArray<number>,
): BookmarkItem[] {
  if (path.length === 0) return items.slice();
  const idx = path[0];
  const next = items.slice();
  if (idx < 0 || idx >= next.length) return next;
  if (path.length === 1) {
    next.splice(idx, 1);
    return next;
  }
  const target = next[idx];
  if (!target || target.type !== "group") return next;
  next[idx] = { ...target, items: removeAtPath(target.items, path.slice(1)) };
  return next;
}

/** Return a new tree with a transform applied to the item at `path`. The
 *  transform returns a replacement item, or null to leave it unchanged. */
function updateAtPath(
  items: ReadonlyArray<BookmarkItem>,
  path: ReadonlyArray<number>,
  fn: (item: BookmarkItem) => BookmarkItem,
): BookmarkItem[] {
  if (path.length === 0) return items.slice();
  const idx = path[0];
  const next = items.slice();
  if (idx < 0 || idx >= next.length) return next;
  const target = next[idx];
  if (!target) return next;
  if (path.length === 1) {
    next[idx] = fn(target);
    return next;
  }
  if (target.type !== "group") return next;
  next[idx] = { ...target, items: updateAtPath(target.items, path.slice(1), fn) };
  return next;
}

function clampIndex(idx: number, len: number): number {
  if (idx < 0) return 0;
  if (idx > len) return len;
  return idx;
}

/** True if `descendantOrSelf` addresses the same node as `ancestor` or a node
 *  inside it (used to forbid moving a group into itself / its own subtree). */
function isAncestorOrSelf(
  ancestor: ReadonlyArray<number>,
  descendantOrSelf: ReadonlyArray<number>,
): boolean {
  if (descendantOrSelf.length < ancestor.length) return false;
  for (let i = 0; i < ancestor.length; i++) {
    if (ancestor[i] !== descendantOrSelf[i]) return false;
  }
  return true;
}

/* ---------------- recursive predicates ---------------- */

function anyFileMatches(items: ReadonlyArray<BookmarkItem>, path: string): boolean {
  for (const item of items) {
    if (item.type === "file" && item.path === path) return true;
    if (item.type === "group" && anyFileMatches(item.items, path)) return true;
  }
  return false;
}

/** Remove every `file` item whose path === `path`, anywhere in the tree. */
function removeAllFiles(
  items: ReadonlyArray<BookmarkItem>,
  path: string,
): BookmarkItem[] {
  const out: BookmarkItem[] = [];
  for (const item of items) {
    if (item.type === "file" && item.path === path) continue;
    if (item.type === "group") {
      out.push({ ...item, items: removeAllFiles(item.items, path) });
    } else {
      out.push(item);
    }
  }
  return out;
}

/* ---------------- persistence (serialized RMW) ---------------- */

/** Enqueue a write of the current in-memory `items` into bookmarks.json,
 *  preserving any unknown top-level keys via a fresh read-modify-write. A
 *  malformed existing file aborts the write (never erase Obsidian's data). */
function persist(): Promise<void> {
  const vault = regVault;
  if (!vault) return Promise.resolve();
  return regEnqueue("persist", async () => {
    if (!vault.isOpen) {
      console.warn(`[bookmarks] vault closed — ${BOOKMARKS_CONFIG} write skipped`);
      return;
    }
    // vault-switch race guard: openVaultFlow re-points vault.adapter in place;
    // if that happens between read and write, this vault's bookmarks would be
    // written into the new vault's file. Capture identity, verify before write.
    const adapterBefore = vault.adapter;

    let root: Record<string, unknown> = {};
    const raw = await vault.adapter.readConfig(BOOKMARKS_CONFIG);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw); // throws → chain catches + warns
      if (!isPlainObject(parsed)) {
        throw new Error(
          `${BOOKMARKS_CONFIG} is not a JSON object — refusing to overwrite`,
        );
      }
      // an existing file with a non-array `items` is malformed: abort rather
      // than blow away whatever structure Obsidian put there.
      if ("items" in parsed && !Array.isArray((parsed as Record<string, unknown>).items)) {
        throw new Error(
          `${BOOKMARKS_CONFIG} "items" is not an array — refusing to overwrite`,
        );
      }
      root = { ...(parsed as Record<string, unknown>) };
    }

    root.items = serializeItems(itemsStore.get());

    if (vault.adapter !== adapterBefore || !vault.isOpen) {
      console.warn(`[bookmarks] vault switched mid-write — ${BOOKMARKS_CONFIG} skipped`);
      return; // a queued re-init rebuilds in-memory items from the new vault
    }
    await vault.adapter.writeConfig(BOOKMARKS_CONFIG, JSON.stringify(root, null, 2));
  });
}

async function regRunInit(vault: Vault): Promise<void> {
  regVault = vault;
  let parsedItems: BookmarkItem[] = [];
  if (vault.isOpen) {
    let raw: string | null = null;
    try {
      raw = await vault.adapter.readConfig(BOOKMARKS_CONFIG);
    } catch (err) {
      regWarn(`failed to read ${BOOKMARKS_CONFIG} — bookmarks empty`, err);
    }
    if (raw === null) {
      // missing file is normal (no bookmarks yet) — quiet empty state
      parsedItems = [];
    } else {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isPlainObject(parsed) && Array.isArray(parsed.items)) {
          parsedItems = parseItems(parsed.items);
        } else if (isPlainObject(parsed)) {
          regWarn(`${BOOKMARKS_CONFIG} has no "items" array — bookmarks empty`);
        } else {
          regWarn(`${BOOKMARKS_CONFIG} is not a JSON object — bookmarks empty`);
        }
      } catch (err) {
        regWarn(`${BOOKMARKS_CONFIG} is not valid JSON — bookmarks empty`, err);
      }
    }
  }
  itemsStore.set(parsedItems);
}

export const bookmarks: BookmarksApi = {
  items: itemsStore,

  init: (vault: Vault) => regEnqueue("init", () => regRunInit(vault)),

  isFileBookmarked(path: string): boolean {
    return anyFileMatches(itemsStore.get(), path);
  },

  async add(item: BookmarkItem, groupPath?: ReadonlyArray<number>): Promise<void> {
    const items = itemsStore.get();
    // file dedup at the target location only (Obsidian allows the same file in
    // different groups, but not duplicated within one container).
    if (item.type === "file") {
      const container = getGroupAt(items, groupPath);
      const siblings = container ? container.items : items;
      if (siblings.some((s) => s.type === "file" && s.path === item.path)) {
        return; // no-op: already present here
      }
    }
    const stamped: BookmarkItem =
      item.ctime === undefined ? ({ ...item, ctime: Date.now() } as BookmarkItem) : item;
    itemsStore.set(insertInto(items, groupPath, stamped));
    await persist();
  },

  async toggleFile(path: string): Promise<void> {
    const items = itemsStore.get();
    if (anyFileMatches(items, path)) {
      itemsStore.set(removeAllFiles(items, path));
    } else {
      const item: FileBookmark = { type: "file", path, ctime: Date.now() };
      itemsStore.set(insertInto(items, undefined, item));
    }
    await persist();
  },

  async removeAt(path: ReadonlyArray<number>): Promise<void> {
    if (path.length === 0) return;
    itemsStore.set(removeAtPath(itemsStore.get(), path));
    await persist();
  },

  async setTitleAt(path: ReadonlyArray<number>, title: string): Promise<void> {
    if (path.length === 0) return;
    const next = updateAtPath(itemsStore.get(), path, (item) => {
      const trimmed = title;
      if (trimmed === "") {
        const { title: _drop, ...rest } = item;
        void _drop;
        return rest as BookmarkItem;
      }
      return { ...item, title: trimmed } as BookmarkItem;
    });
    itemsStore.set(next);
    await persist();
  },

  async addGroup(title: string, groupPath?: ReadonlyArray<number>): Promise<void> {
    const group: GroupBookmark = {
      type: "group",
      title,
      items: [],
      ctime: Date.now(),
    };
    itemsStore.set(insertInto(itemsStore.get(), groupPath, group));
    await persist();
  },

  async move(
    from: ReadonlyArray<number>,
    toGroup: ReadonlyArray<number>,
    toIndex: number,
  ): Promise<void> {
    if (from.length === 0) return;
    // Forbid moving a group into itself or its own descendant.
    if (isAncestorOrSelf(from, toGroup)) return;

    const items = itemsStore.get();
    // grab the moving item (and its current parent path + index) before removal
    const parentPath = from.slice(0, -1);
    const fromIndex = from[from.length - 1];
    const parentGroup = getGroupAt(items, parentPath);
    const parentItems = parentGroup ? parentGroup.items : items;
    const moving = parentItems[fromIndex];
    if (!moving) return;

    // remove first, then compute the (possibly shifted) destination.
    let next = removeAtPath(items, from);

    // The removal shifts later siblings of `from` (and any path descending
    // THROUGH a later sibling) down by one. If the destination GROUP path
    // descends through such a sibling, its index at the removal depth must drop
    // by one — otherwise `toGroup` points at the wrong node (or out of range)
    // and the moved item would be silently dropped. (E.g. moving top item [1]
    // into the group at [2]: after removal the group lives at [1].)
    const depth = parentPath.length;
    const adjGroup = toGroup.slice();
    if (
      toGroup.length > depth &&
      parentPath.every((v, i) => v === toGroup[i]) &&
      toGroup[depth] > fromIndex
    ) {
      adjGroup[depth] = toGroup[depth] - 1;
    }

    // same-container reorder: when source and destination are the SAME array and
    // the removed item sat BEFORE the target slot, the insertion index drops too.
    let insertIdx = toIndex;
    const sameParent =
      parentPath.length === adjGroup.length &&
      parentPath.every((v, i) => v === adjGroup[i]);
    if (sameParent && fromIndex < toIndex) {
      insertIdx = toIndex - 1;
    }

    next = insertInto(next, adjGroup, moving, insertIdx);
    itemsStore.set(next);
    await persist();
  },
};
