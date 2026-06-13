import type { FileNode, FolderNode, VaultNode } from "./types";
import { EventBus } from "./events";
import { Store } from "./store";

/**
 * VaultAdapter — the IO boundary. Two implementations:
 *  - TauriVaultAdapter: real filesystem via Tauri IPC (desktop)
 *  - MemoryVaultAdapter: in-memory demo vault (browser dev / E2E tests)
 * All paths are vault-relative, forward slashes.
 */
/** One installed Obsidian community plugin found under `<vault>/.obsidian/plugins/`. */
export interface ObsidianPluginSource {
  /** folder name under .obsidian/plugins (should equal the manifest id) */
  dir: string;
  manifestJson: string;
  mainJs: string;
  stylesCss: string | null;
  dataJson: string | null;
}

export interface VaultAdapter {
  readonly kind: "tauri" | "memory";
  /** show folder picker; returns absolute path or null if cancelled */
  pickVaultFolder(): Promise<string | null>;
  /** point the adapter at a vault root (absolute path; ignored by memory) */
  setVaultPath(absPath: string): void;
  getVaultPath(): string | null;
  listTree(): Promise<FolderNode>;
  readFile(path: string): Promise<string>;
  /** Read a file's raw bytes (image embeds, R11). Rejects when missing. */
  readBinary(path: string): Promise<Uint8Array>;
  /** Write raw bytes to a NEW file (attachment ingestion, R17). Rejects when
   *  the path already exists; parent folders are created as needed. */
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** R42: move a file/folder to the vault's local `.trash/` (recoverable). Returns
   *  the trash-relative path (e.g. `.trash/note.md`). */
  trash(path: string): Promise<string>;
  /** R42: list top-level entries under `.trash/` (vault-relative paths). */
  listTrash(): Promise<string[]>;
  /**
   * Start (or restart) watching the vault for EXTERNAL filesystem changes.
   * `onChange` receives debounced vault-relative paths. No-op for memory.
   */
  startWatch(onChange: (paths: string[]) => void): Promise<void>;
  /** List external plugin files at <vault>/.geode/plugins/*.js (name + source). */
  listPluginFiles(): Promise<Array<{ name: string; content: string }>>;
  /** List installed Obsidian plugins under `<vault>/.obsidian/plugins/` (R4 compat). */
  listObsidianPlugins(): Promise<ObsidianPluginSource[]>;
  /**
   * Read a file under `<vault>/.obsidian/` (e.g. "community-plugins.json",
   * "plugins/<id>/data.json"). Returns null when the file does not exist.
   */
  readConfig(relPath: string): Promise<string | null>;
  /** Write a file under `<vault>/.obsidian/`, creating parent directories. */
  writeConfig(relPath: string, content: string): Promise<void>;
  /**
   * List entries directly under `<vault>/.obsidian/<relPath>` (non-recursive).
   * A missing directory yields an empty list (R20 themes/snippets discovery).
   */
  listConfigDir(relPath: string): Promise<ConfigDirEntry[]>;
}

/** One entry under an `.obsidian/` subdirectory (R20). Mirrors Rust ConfigDirEntry. */
export interface ConfigDirEntry {
  name: string;
  isDir: boolean;
}

/* ---------------- helpers ---------------- */

export function basename(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name;
}

export function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export function extension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function makeFileNode(path: string): FileNode {
  const name = basename(path);
  return { kind: "file", path, name, basename: stripExtension(name), extension: extension(name) };
}

/** depth-first list of all files in a tree */
export function flattenFiles(root: FolderNode): FileNode[] {
  const out: FileNode[] = [];
  const walk = (node: VaultNode) => {
    if (node.kind === "file") out.push(node);
    else node.children.forEach(walk);
  };
  walk(root);
  return out;
}

function sortChildren(folder: FolderNode) {
  folder.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
  folder.children.forEach((c) => c.kind === "folder" && sortChildren(c));
}

/* ---------------- Vault: the API features use ---------------- */

/** Total characters the content cache may hold before evicting oldest entries. */
const CONTENT_CACHE_BUDGET = 30_000_000;

/** How long a self-write fingerprint stays valid for watcher echo suppression. */
const SELF_WRITE_TTL_MS = 10_000;

/** FNV-1a 32-bit hash over a string (self-write fingerprints, cheap + local). */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Always-on watcher echo probe counters on window.__geodeWatchEcho (both ends). */
const watchEchoCounters = (() => {
  const g = globalThis as unknown as {
    __geodeWatchEcho?: { suppressed: number; external: number };
  };
  g.__geodeWatchEcho ??= { suppressed: 0, external: 0 };
  return g.__geodeWatchEcho;
})();

/**
 * Vault wraps an adapter with caching + events. Feature modules should use
 * this class (via AppContext), never the adapter directly.
 */
export class Vault {
  readonly tree = new Store<FolderNode | null>(null);
  /** LRU via Map insertion order; bounded by CONTENT_CACHE_BUDGET chars */
  private contentCache = new Map<string, string>();
  private contentCacheChars = 0;
  /** O(1) existence lookups. Rebuilt ONLY by indexTree(), which runs at the
   *  two central tree choke points — load() and refreshTree() — and nowhere
   *  else, so the sets can never drift from this.tree. */
  private filePaths = new Set<string>();
  private folderPaths = new Set<string>();
  /** Fingerprints of our own recent writes, so watcher echoes can be told
   *  apart from real external changes. Entries live for SELF_WRITE_TTL_MS
   *  (one write may echo back as several notify batches). */
  private recentSelfWrites = new Map<string, { hash: number; at: number }>();

  constructor(
    readonly adapter: VaultAdapter,
    readonly events: EventBus,
  ) {}

  get isOpen(): boolean {
    return this.tree.get() !== null;
  }

  get vaultName(): string {
    const p = this.adapter.getVaultPath();
    if (!p) return this.adapter.kind === "memory" ? "Demo Vault" : "Vault";
    return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "Vault";
  }

  /** All markdown + other files, flat. Empty array if no vault open. */
  getFiles(): FileNode[] {
    const t = this.tree.get();
    return t ? flattenFiles(t) : [];
  }

  getMarkdownFiles(): FileNode[] {
    return this.getFiles().filter((f) => f.extension === "md");
  }

  fileExists(path: string): boolean {
    return this.filePaths.has(path);
  }

  folderExists(path: string): boolean {
    // the root ("") is deliberately excluded, matching the pre-index behavior
    return path !== "" && this.folderPaths.has(path);
  }

  /** Rebuild the O(1) path indexes from a freshly listed tree (one walk). */
  private indexTree(root: FolderNode): void {
    this.filePaths.clear();
    this.folderPaths.clear();
    const walk = (node: VaultNode) => {
      if (node.kind === "file") {
        this.filePaths.add(node.path);
      } else {
        if (node.path) this.folderPaths.add(node.path);
        node.children.forEach(walk);
      }
    };
    walk(root);
  }

  async load(): Promise<void> {
    const tree = await this.adapter.listTree();
    sortChildren(tree);
    this.indexTree(tree);
    this.contentCache.clear();
    this.contentCacheChars = 0;
    this.tree.set(tree);
    this.events.emit("vault:changed", { reason: "load" });
    // watch for external filesystem changes (no-op for the memory adapter)
    try {
      await this.adapter.startWatch((paths) => void this.handleExternalChanges(paths));
    } catch (err) {
      console.warn("[vault] file watcher unavailable", err);
    }
  }

  /**
   * Reconcile EXTERNAL filesystem changes (from the watcher): refresh the
   * tree, drop stale cache entries, and notify the app. Editors decide
   * whether to reload based on their own dirty state.
   */
  private async handleExternalChanges(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    // Echo suppression: a path we recently wrote ourselves is re-read and
    // hash-compared. Match -> it's our own write echoing back through the
    // watcher: keep the cache (it IS the written content), emit nothing.
    // Mismatch or read error -> someone really changed it externally; drop
    // the fingerprint and let it through (never mis-suppress real changes).
    const now = Date.now();
    const survivors: string[] = [];
    for (const path of paths) {
      const entry = this.recentSelfWrites.get(path);
      if (entry && now - entry.at <= SELF_WRITE_TTL_MS) {
        let matched = false;
        try {
          matched = fnv1a32(await this.adapter.readFile(path)) === entry.hash;
        } catch {
          matched = false; // unreadable -> cannot verify, treat as external
        }
        if (matched) {
          watchEchoCounters.suppressed++;
          continue; // suppressed: no cache delete, no events for this path
        }
        this.recentSelfWrites.delete(path);
      }
      watchEchoCounters.external++;
      survivors.push(path);
    }
    if (survivors.length === 0) return; // pure echo batch: zero work
    await this.refreshTree();
    for (const path of survivors) {
      if (this.contentCache.has(path)) this.cacheDelete(path);
    }
    for (const path of survivors) {
      if (path.toLowerCase().endsWith(".md") && this.fileExists(path)) {
        this.events.emit("file:external-modified", { path });
        this.events.emit("file:modified", { path }); // reuse reindex pipeline
      } else if (this.fileExists(path)) {
        this.events.emit("file:created", { path });
      } else if (!this.folderExists(path)) {
        // neither file nor folder in the refreshed tree -> truly deleted.
        // (Windows watchers report parent FOLDER paths on child changes —
        // an existing folder must never be classified as a deleted file.)
        this.events.emit("file:deleted", { path });
      }
    }
    this.events.emit("vault:external-changed", { paths: survivors });
    this.events.emit("vault:changed", { reason: "modify" });
  }

  /** Remember a self-write fingerprint (and opportunistically prune expired ones). */
  private recordSelfWrite(path: string, content: string): void {
    const now = Date.now();
    for (const [p, e] of this.recentSelfWrites) {
      if (now - e.at > SELF_WRITE_TTL_MS) this.recentSelfWrites.delete(p);
    }
    this.recentSelfWrites.set(path, { hash: fnv1a32(content), at: now });
  }

  /** Drop a fingerprint after a FAILED write — but only if it still belongs to
   *  that write (a newer concurrent write to the same path must keep its own). */
  private clearSelfWrite(path: string, content: string): void {
    const entry = this.recentSelfWrites.get(path);
    if (entry && entry.hash === fnv1a32(content)) this.recentSelfWrites.delete(path);
  }

  /** BOM strip + CRLF→LF, applied to every string entering the app (R16).
   *  CodeMirror normalizes documents to "\n" internally, so a CRLF canonical
   *  text would put DocumentHandle offsets and CM doc offsets in DIFFERENT
   *  coordinate spaces — the R16 review reproduced silent mid-file corruption
   *  from exactly that. Pre-R16 behaviour already converted CRLF files to LF
   *  on the first keystroke; normalizing at the choke point makes it
   *  consistent (recorded deviation: Obsidian preserves CRLF on disk). */
  private static normalizeContent(raw: string): string {
    const noBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return noBom.includes("\r") ? noBom.replace(/\r\n?/g, "\n") : noBom;
  }

  async read(path: string): Promise<string> {
    const cached = this.contentCache.get(path);
    if (cached !== undefined) {
      this.cacheSet(path, cached); // refresh LRU recency
      return cached;
    }
    // strip a leading UTF-8 BOM (common in files written by Windows tools —
    // PowerShell 5.1 "utf8" is BOM'd): it breaks first-line headings in
    // markdown-it AND metadata parsing. Single choke point: every consumer
    // (editor buffer, preview, embeds, compat) reads through here.
    const raw = await this.adapter.readFile(path);
    const content = Vault.normalizeContent(raw);
    this.cacheSet(path, content);
    return content;
  }

  /** Read BYPASSING the content cache (R16 review fix): the rewrite engine
   *  must never derive edits for a closed file from a cached snapshot — an
   *  external change inside the watcher's debounce window would be invisible
   *  and silently overwritten. Refreshes the cache with what disk holds NOW. */
  async readFresh(path: string): Promise<string> {
    const raw = await this.adapter.readFile(path);
    const content = Vault.normalizeContent(raw);
    this.cacheSet(path, content);
    return content;
  }

  /** Read raw bytes (image embeds, R11). Uncached — callers cache at their level. */
  async readBinary(path: string): Promise<Uint8Array> {
    return this.adapter.readBinary(path);
  }

  /** read from cache only (sync) — may be undefined if never read */
  readCached(path: string): string | undefined {
    return this.contentCache.get(path);
  }

  async modify(path: string, content: string): Promise<void> {
    // record BEFORE awaiting the write — the echo can arrive mid-write.
    // The fingerprint hashes the RAW bytes (echo suppression re-reads the
    // adapter); the cache stores the NORMALIZED form so it always mirrors
    // what read() would return (a compat plugin may pass CRLF content).
    this.recordSelfWrite(path, content);
    try {
      await this.adapter.writeFile(path, content);
    } catch (err) {
      // a failed write must not leave its fingerprint behind: a real external
      // change with the same bytes within the TTL would be mis-suppressed
      this.clearSelfWrite(path, content);
      throw err;
    }
    this.cacheSet(path, Vault.normalizeContent(content));
    this.events.emit("file:modified", { path });
    this.events.emit("vault:changed", { reason: "modify" });
  }

  /** Create a file; auto-creates "Untitled n.md" style unique names upstream. */
  async create(path: string, content = ""): Promise<void> {
    // record BEFORE awaiting the write — the echo can arrive mid-write
    this.recordSelfWrite(path, content);
    try {
      await this.adapter.createFile(path, content);
    } catch (err) {
      this.clearSelfWrite(path, content);
      throw err;
    }
    this.cacheSet(path, Vault.normalizeContent(content));
    await this.refreshTree();
    this.events.emit("file:created", { path });
    this.events.emit("vault:changed", { reason: "create" });
  }

  /** Create a new binary file (attachment ingestion, R17). Uncached; no echo
   *  fingerprint (FNV is text-scoped) — on desktop the watcher reports our own
   *  create as external, costing one redundant tree refresh (safe direction). */
  async createBinary(path: string, data: Uint8Array): Promise<void> {
    await this.adapter.writeBinary(path, data);
    await this.refreshTree();
    this.events.emit("file:created", { path });
    this.events.emit("vault:changed", { reason: "create" });
  }

  async createFolder(path: string): Promise<void> {
    await this.adapter.createFolder(path);
    await this.refreshTree();
    this.events.emit("vault:changed", { reason: "create" });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.adapter.rename(oldPath, newPath);
    // remap cache entries under this path (file or folder rename)
    for (const key of [...this.contentCache.keys()]) {
      if (key === oldPath || key.startsWith(oldPath + "/")) {
        const cached = this.contentCache.get(key)!;
        this.cacheDelete(key);
        this.cacheSet(newPath + key.slice(oldPath.length), cached);
      }
    }
    await this.refreshTree();
    this.events.emit("file:renamed", { oldPath, newPath });
    this.events.emit("vault:changed", { reason: "rename" });
  }

  async remove(path: string): Promise<void> {
    await this.adapter.remove(path);
    // drop cache entries under this path (file or folder)
    for (const key of [...this.contentCache.keys()]) {
      if (key === path || key.startsWith(path + "/")) this.cacheDelete(key);
    }
    await this.refreshTree();
    this.events.emit("file:deleted", { path });
    this.events.emit("vault:changed", { reason: "delete" });
  }

  /** R42: move a path to the local `.trash/` (recoverable delete). Returns the
   *  trash-relative path. Emits file:deleted (the file leaves the visible vault). */
  async trash(path: string): Promise<string> {
    const trashPath = await this.adapter.trash(path);
    for (const key of [...this.contentCache.keys()]) {
      if (key === path || key.startsWith(path + "/")) this.cacheDelete(key);
    }
    await this.refreshTree();
    this.events.emit("file:deleted", { path });
    this.events.emit("vault:changed", { reason: "delete" });
    return trashPath;
  }

  /** R42: top-level entries under `.trash/`. */
  async listTrash(): Promise<string[]> {
    return this.adapter.listTrash();
  }

  /** R42: restore a trashed entry to `targetPath`. Uses a RAW adapter move (NOT
   *  Vault.rename — no link-text rewrite; the file is coming back, not being
   *  renamed). Emits file:renamed (NOT file:created) so a restored FOLDER's `.md`
   *  children are reindexed via reindexFolder (file:created → reindexFile early-
   *  returns on a non-`.md` folder path, leaving backlinks/graph/search stale —
   *  R42 review). file:renamed does not rewrite link text (that lives in the
   *  explicit renameWithLinkUpdate, not in any file:renamed listener). */
  async restoreFromTrash(trashRelPath: string, targetPath: string): Promise<void> {
    await this.adapter.rename(trashRelPath, targetPath);
    await this.refreshTree();
    this.events.emit("file:renamed", { oldPath: trashRelPath, newPath: targetPath });
    this.events.emit("vault:changed", { reason: "create" });
  }

  /** Pick a unique path like "Untitled.md", "Untitled 1.md", ... in a folder. */
  uniquePath(folder: string, base: string, ext = "md"): string {
    const prefix = folder ? `${folder}/` : "";
    let candidate = `${prefix}${base}.${ext}`;
    let n = 1;
    while (this.fileExists(candidate)) {
      candidate = `${prefix}${base} ${n}.${ext}`;
      n++;
    }
    return candidate;
  }

  private async refreshTree() {
    const tree = await this.adapter.listTree();
    sortChildren(tree);
    this.indexTree(tree);
    this.tree.set(tree);
  }

  /** Insert (or refresh) a cache entry, evicting oldest entries over budget. */
  private cacheSet(path: string, content: string) {
    this.cacheDelete(path);
    this.contentCache.set(path, content);
    this.contentCacheChars += content.length;
    while (this.contentCacheChars > CONTENT_CACHE_BUDGET && this.contentCache.size > 1) {
      const oldest = this.contentCache.keys().next().value as string;
      this.cacheDelete(oldest);
    }
  }

  private cacheDelete(path: string) {
    const prev = this.contentCache.get(path);
    if (prev === undefined) return;
    this.contentCacheChars -= prev.length;
    this.contentCache.delete(path);
  }
}

/* ---------------- Memory adapter (browser dev + E2E) ---------------- */

/** Binary fixtures for the demo vault (path → base64). Mirrors demo-vault/ on disk. */
const DEMO_BINARY: Record<string, string> = {
  // 1x1 png — the same bytes as demo-vault/assets/geode-dot.png
  "assets/geode-dot.png":
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const DEMO_FILES: Record<string, string> = {
  "Welcome.md": `# Welcome to Geode 💎

Geode is a **local-first** markdown knowledge base.

- Create notes, link them with [[Wiki Links]]
- Explore connections in the [[Graph View|graph]]
- Press \`Ctrl+P\` for the command palette, \`Ctrl+O\` to quick-switch notes

Start with [[Getting Started]] or read about [[Daily Notes]].

Image embeds render inline: ![[geode-dot.png]]

#welcome #intro
`,
  "Getting Started.md": `# Getting Started

1. Open the file explorer on the left
2. Create a new note with the + button or \`Ctrl+N\`
3. Type \`[[\` to link to another note — try linking to [[Welcome]]
4. Toggle edit/preview with \`Ctrl+E\`

Related: [[Wiki Links]], [[Markdown Syntax]]

#intro #guide
`,
  "Wiki Links.md": `# Wiki Links

Wiki links connect your notes: \`[[Note Name]]\` or \`[[Note Name|custom text]]\`.

Links to notes that don't exist yet (like [[Future Idea]]) appear dimmed —
click one to create the note instantly.

Backlinks from [[Welcome]] and [[Getting Started]] show up in the right panel.

#guide
`,
  "Markdown Syntax.md": `# Markdown Syntax

## Emphasis
**bold**, *italic*, ~~strikethrough~~, \`inline code\`

## Lists
- bullet
- [ ] task to do
- [x] task done

## Quote
> Knowledge is a network, not a hierarchy.

## Code
\`\`\`ts
const geode = "💎";
\`\`\`

See also [[Getting Started]].

#guide #markdown
`,
  "Daily Notes/2026-06-09.md": `# 2026-06-09

Started exploring [[Welcome|Geode]]. The [[Graph View]] is neat.

- [x] Set up vault
- [ ] Migrate notes

#daily
`,
  "Daily Notes/2026-06-10.md": `# 2026-06-10

Reading [[Markdown Syntax]] and practicing [[Wiki Links]].

#daily
`,
  "Graph View.md": `# Graph View

The graph shows every note as a node and every link as an edge.
Open it from the ribbon or the command palette.

Hub notes like [[Welcome]] grow bigger as more notes link to them.

#guide
`,
  "Projects/Geode Roadmap.md": `# Geode Roadmap

## Now
- Core editing experience — see [[Markdown Syntax]]
- [[Wiki Links]] + backlinks + graph

## Later
- Plugin marketplace
- Sync

#project #roadmap
`,
  // R23 template fixtures — mirrored on disk at demo-vault/templates/ (byte-identical).
  "templates/Meeting Notes.md": `---
type: meeting
status: draft
---

# {{title}}

Created: {{date}} {{time}}

## Attendees

-

## Notes

-
`,
  "templates/Daily Log.md": `---
type: daily
---

# Daily Log — {{date:dddd, MMMM Do YYYY}}

Literal (not a variable): {{title:bogus}}

## Today

-
`,
  // R24 unlinked-mentions fixtures — mirrored on disk at demo-vault/ (byte-identical).
  // "Zettelkasten" has alias "ZK"; "On Knowledge" references it in prose in
  // several ways. Deterministic so E2E can assert exactly 4 unlinked mentions:
  // 3 plain "Zettelkasten" + 1 alias "ZK". Excluded: the already-linked
  // [[Zettelkasten]], the inline-code `Zettelkasten`, and the plural
  // "Zettelkastens" (word-boundary reject).
  "Zettelkasten.md": `---
aliases: [ZK]
---

# Zettelkasten

A Zettelkasten is a personal knowledge-management system built from atomic,
densely linked notes.
`,
  "On Knowledge.md": `# On Knowledge

The Zettelkasten method shapes how I take notes. A good Zettelkasten is a
network of atomic notes, and every Zettelkasten grows richer over time.

I keep my own ZK in this vault — see [[Zettelkasten]] for the index note.

In code you reference it as \`Zettelkasten\`, which must stay plain text.

Note that "Zettelkastens" (plural) must not be detected as a mention.

#knowledge
`,
};

/* ---- synthetic bench vault (?bench=N) ---- */

/** Deterministic LCG PRNG (numerical recipes constants) — reproducible seeds. */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BENCH_WORDS = (
  "knowledge graph note vault markdown editor link tag heading index search " +
  "performance cache render tree pane split workspace plugin command palette " +
  "outline backlink preview syntax daily project roadmap system design memory " +
  "latency throughput benchmark profile optimize virtual scroll lazy debounce"
).split(" ");

const BENCH_TAGS = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "research", "draft", "review", "archive", "daily", "project",
];

/** Read `?bench=N` from the page URL (browser dev only). */
function benchCountFromUrl(): number {
  if (typeof location === "undefined") return 0;
  const m = /[?&]bench=(\d+)/.exec(location.search);
  const n = m ? parseInt(m[1], 10) : 0;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200_000) : 0;
}

/**
 * Generate `count` synthetic notes, 100 per folder, each 0.5–3KB with
 * 2–6 wikilinks to random other notes, 2–4 headings and 1–3 tags.
 * Fully deterministic for a given `count` (LCG seeded with 42).
 */
export function makeBenchSeed(count: number): Record<string, string> {
  const rnd = makeLcg(42);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const titles: string[] = new Array(count);
  for (let i = 0; i < count; i++) {
    titles[i] = `Note ${String(i).padStart(5, "0")} ${BENCH_WORDS[i % BENCH_WORDS.length]}`;
  }

  const sentence = (words: number): string => {
    const out: string[] = [];
    for (let w = 0; w < words; w++) out.push(pick(BENCH_WORDS));
    return out.join(" ");
  };

  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const folder = `Folder ${String(Math.floor(i / 100)).padStart(3, "0")}`;
    const targetBytes = int(512, 3072);
    const nHeadings = int(2, 4);
    const nLinks = int(2, 6);
    const nTags = int(1, 3);

    const parts: string[] = [`# ${titles[i]}\n`];
    const tagLine: string[] = [];
    for (let t = 0; t < nTags; t++) tagLine.push(`#${pick(BENCH_TAGS)}`);
    parts.push(`${tagLine.join(" ")}\n`);

    // distribute links across sections
    let linksLeft = nLinks;
    for (let h = 1; h < nHeadings; h++) {
      parts.push(`\n## ${sentence(3)}\n`);
      parts.push(`\n${sentence(int(8, 20))}.\n`);
      const linksHere = h === nHeadings - 1 ? linksLeft : int(0, linksLeft);
      for (let l = 0; l < linksHere; l++) {
        let j = int(0, count - 1);
        if (j === i) j = (j + 1) % count;
        parts.push(`- see [[${titles[j]}]] for ${sentence(2)}\n`);
      }
      linksLeft -= linksHere;
    }
    let body = parts.join("");
    while (body.length < targetBytes) {
      body += `\n${sentence(int(10, 24))}.\n`;
    }
    files[`${folder}/${titles[i]}.md`] = body;
  }
  return files;
}

export class MemoryVaultAdapter implements VaultAdapter {
  readonly kind = "memory" as const;
  private files = new Map<string, string>();
  private binaryFiles = new Map<string, Uint8Array>();
  private folders = new Set<string>();

  constructor(seed?: Record<string, string>) {
    let actual = seed;
    let seedBinaries = false;
    if (actual === undefined) {
      const bench = benchCountFromUrl();
      if (bench > 0) {
        const t0 = performance.now();
        actual = makeBenchSeed(bench);
        const g = globalThis as unknown as { __geodePerf?: Record<string, number> };
        g.__geodePerf = { ...g.__geodePerf, benchCount: bench, benchSeedMs: performance.now() - t0 };
      } else {
        actual = DEMO_FILES;
        seedBinaries = true;
      }
    }
    for (const [path, content] of Object.entries(actual)) {
      this.files.set(path, content);
      let parent = parentPath(path);
      while (parent) {
        this.folders.add(parent);
        parent = parentPath(parent);
      }
    }
    if (seedBinaries) {
      for (const [path, b64] of Object.entries(DEMO_BINARY)) {
        this.binaryFiles.set(path, base64ToBytes(b64));
        let parent = parentPath(path);
        while (parent) {
          this.folders.add(parent);
          parent = parentPath(parent);
        }
      }
    }
  }

  async pickVaultFolder(): Promise<string | null> {
    return null; // memory vault is always "open"
  }

  setVaultPath(_absPath: string): void {}

  getVaultPath(): string | null {
    return null;
  }

  async startWatch(onChange: (paths: string[]) => void): Promise<void> {
    // nothing external can change an in-memory vault, but browser E2E can
    // simulate watcher events via window.__geodeFireWatch(paths)
    const g = globalThis as unknown as { __geodeFireWatch?: (paths: string[]) => void };
    g.__geodeFireWatch = (paths: string[]) => onChange(paths);
  }

  async listPluginFiles(): Promise<Array<{ name: string; content: string }>> {
    return [];
  }

  /** Browser E2E injects fixtures via `window.__geodeObsidianPlugins` before load. */
  async listObsidianPlugins(): Promise<ObsidianPluginSource[]> {
    const g = globalThis as unknown as { __geodeObsidianPlugins?: ObsidianPluginSource[] };
    return Array.isArray(g.__geodeObsidianPlugins) ? g.__geodeObsidianPlugins : [];
  }

  /** in-session `.obsidian/` config store (not part of the visible tree) */
  private configFiles = new Map<string, string>();

  /** Browser E2E seeds `.obsidian/` fixtures via `window.__geodeObsidianConfig`
   *  (relPath → content) before load (R20; mirrors __geodeObsidianPlugins). */
  private seedConfigFromWindow(): void {
    if (this.configSeeded) return;
    this.configSeeded = true;
    const g = globalThis as unknown as { __geodeObsidianConfig?: Record<string, string> };
    const seed = g.__geodeObsidianConfig;
    if (!seed || typeof seed !== "object") return;
    for (const [relPath, content] of Object.entries(seed)) {
      if (typeof content === "string" && !this.configFiles.has(relPath)) {
        this.configFiles.set(relPath, content);
      }
    }
  }
  private configSeeded = false;

  async readConfig(relPath: string): Promise<string | null> {
    this.seedConfigFromWindow();
    return this.configFiles.get(relPath) ?? null;
  }

  async writeConfig(relPath: string, content: string): Promise<void> {
    this.seedConfigFromWindow();
    this.configFiles.set(relPath, content);
  }

  async listConfigDir(relPath: string): Promise<ConfigDirEntry[]> {
    this.seedConfigFromWindow();
    const prefix = relPath === "" ? "" : relPath.replace(/\/+$/, "") + "/";
    const names = new Map<string, boolean>(); // name → isDir
    for (const key of this.configFiles.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf("/");
      if (slash === -1) {
        if (!names.has(rest)) names.set(rest, false);
      } else {
        names.set(rest.slice(0, slash), true);
      }
    }
    return [...names.entries()]
      .map(([name, isDir]) => ({ name, isDir }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async listTree(): Promise<FolderNode> {
    const root: FolderNode = { kind: "folder", path: "", name: "", children: [] };
    const folderNodes = new Map<string, FolderNode>([["", root]]);
    const ensureFolder = (path: string): FolderNode => {
      const existing = folderNodes.get(path);
      if (existing) return existing;
      const node: FolderNode = { kind: "folder", path, name: basename(path), children: [] };
      folderNodes.set(path, node);
      ensureFolder(parentPath(path)).children.push(node);
      return node;
    };
    for (const folder of this.folders) {
      if (folder.split("/")[0].startsWith(".")) continue; // R42: skip dot-prefixed (e.g. .trash) — align with Rust walk
      ensureFolder(folder);
    }
    for (const path of this.files.keys()) {
      if (path.split("/")[0].startsWith(".")) continue; // R42: dot-skip
      ensureFolder(parentPath(path)).children.push(makeFileNode(path));
    }
    for (const path of this.binaryFiles.keys()) {
      if (path.split("/")[0].startsWith(".")) continue; // R42: dot-skip
      ensureFolder(parentPath(path)).children.push(makeFileNode(path));
    }
    return root;
  }

  async readFile(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`File not found: ${path}`);
    return c;
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const b = this.binaryFiles.get(path);
    if (b !== undefined) return b;
    const text = this.files.get(path);
    if (text !== undefined) return new TextEncoder().encode(text);
    throw new Error(`File not found: ${path}`);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    if (this.files.has(path) || this.binaryFiles.has(path) || this.folders.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    this.binaryFiles.set(path, data);
    let parent = parentPath(path);
    while (parent) {
      this.folders.add(parent);
      parent = parentPath(parent);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async createFile(path: string, content: string): Promise<void> {
    if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
    this.files.set(path, content);
    let parent = parentPath(path);
    while (parent) {
      this.folders.add(parent);
      parent = parentPath(parent);
    }
  }

  async createFolder(path: string): Promise<void> {
    // register parents too — fs create_dir_all parity (nested attachment dirs, R17)
    let p: string | null = path;
    while (p) {
      this.folders.add(p);
      p = parentPath(p);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    // mirror the Tauri backend's `to.exists()` guard (src-tauri vault_rename):
    // never silently clobber an existing target. Normal renames are collision-
    // checked upstream; this closes the narrow race where a concurrent external
    // change drops a same-named file into the destination mid-move (R28 review).
    if (oldPath !== newPath && (this.files.has(newPath) || this.folders.has(newPath))) {
      throw new Error(`target already exists: ${newPath}`);
    }
    if (this.files.has(oldPath)) {
      const content = this.files.get(oldPath)!;
      this.files.delete(oldPath);
      this.files.set(newPath, content);
      return;
    }
    if (this.folders.has(oldPath)) {
      this.folders.delete(oldPath);
      this.folders.add(newPath);
      for (const [p, c] of [...this.files]) {
        if (p.startsWith(oldPath + "/")) {
          this.files.delete(p);
          this.files.set(newPath + p.slice(oldPath.length), c);
        }
      }
      for (const f of [...this.folders]) {
        if (f.startsWith(oldPath + "/")) {
          this.folders.delete(f);
          this.folders.add(newPath + f.slice(oldPath.length));
        }
      }
      return;
    }
    throw new Error(`Path not found: ${oldPath}`);
  }

  async remove(path: string): Promise<void> {
    if (this.files.delete(path)) return;
    if (this.folders.has(path)) {
      this.folders.delete(path);
      for (const p of [...this.files.keys()]) if (p.startsWith(path + "/")) this.files.delete(p);
      for (const f of [...this.folders]) if (f.startsWith(path + "/")) this.folders.delete(f);
      return;
    }
    throw new Error(`Path not found: ${path}`);
  }

  async trash(path: string): Promise<string> {
    const base = basename(path);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let name = base;
    let n = 1;
    // R42 review: a trash name must not collide with ANY existing entry (text
    // file / binary file / folder) already under .trash.
    const taken = (d: string) => this.files.has(d) || this.binaryFiles.has(d) || this.folders.has(d);
    while (taken(`.trash/${name}`)) {
      name = `${stem} ${n}${ext}`;
      n++;
    }
    const dest = `.trash/${name}`;
    if (this.files.has(path)) {
      this.files.set(dest, this.files.get(path)!);
      this.files.delete(path);
    } else if (this.binaryFiles.has(path)) {
      // R42 review: binary attachments (pasted images) live in binaryFiles only —
      // without this branch, deleting one in the browser threw "Path not found".
      this.binaryFiles.set(dest, this.binaryFiles.get(path)!);
      this.binaryFiles.delete(path);
    } else if (this.folders.has(path)) {
      this.folders.add(dest);
      this.folders.delete(path);
      for (const [p, c] of [...this.files]) if (p.startsWith(path + "/")) { this.files.set(dest + p.slice(path.length), c); this.files.delete(p); }
      // R42 review: a folder's binary descendants must move too, else they are
      // orphaned in binaryFiles and listTree "revives" the deleted folder.
      for (const [p, b] of [...this.binaryFiles]) if (p.startsWith(path + "/")) { this.binaryFiles.set(dest + p.slice(path.length), b); this.binaryFiles.delete(p); }
      for (const f of [...this.folders]) if (f !== dest && f.startsWith(path + "/")) { this.folders.add(dest + f.slice(path.length)); this.folders.delete(f); }
    } else {
      throw new Error(`Path not found: ${path}`);
    }
    this.folders.add(".trash");
    return dest;
  }

  async listTrash(): Promise<string[]> {
    const out = new Set<string>();
    const top = (p: string) => ".trash/" + p.slice(".trash/".length).split("/")[0];
    for (const p of this.files.keys()) if (p.startsWith(".trash/")) out.add(top(p));
    for (const p of this.binaryFiles.keys()) if (p.startsWith(".trash/")) out.add(top(p));
    for (const f of this.folders) if (f.startsWith(".trash/")) out.add(top(f));
    return [...out];
  }
}

/* ---------------- Tauri adapter (desktop) ---------------- */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Talks to the Rust backend. Command contract (implemented in src-tauri):
 *   vault_list(vault: string) -> FolderNode (serde JSON, same shape as types.ts)
 *   vault_read(vault, path) -> string
 *   vault_write(vault, path, content)
 *   vault_create(vault, path, content)
 *   vault_mkdir(vault, path)
 *   vault_rename(vault, old_path, new_path)
 *   vault_delete(vault, path)
 *   vault_trash(vault, path) -> string   (move into <vault>/.trash/, returns trash-relative path)
 *   vault_list_trash(vault) -> Vec<String>   (top-level entries under .trash/)
 *   vault_watch(vault) -> starts/replaces a debounced fs watcher; the backend
 *     emits the Tauri event "vault:fs-change" with Vec<String> of changed
 *     vault-relative paths (forward slashes)
 *   vault_plugin_files(vault) -> Vec<{ name, content }> of .geode/plugins/*.js
 *   vault_obsidian_plugins(vault) -> Vec<ObsidianPluginSource> (serde camelCase)
 *   vault_read_config(vault, path) -> Option<String>   (path relative to .obsidian/)
 *   vault_write_config(vault, path, content)           (creates parent dirs)
 */
export class TauriVaultAdapter implements VaultAdapter {
  readonly kind = "tauri" as const;
  private vaultPath: string | null = null;
  private unlistenWatch: (() => void) | null = null;

  setVaultPath(absPath: string): void {
    this.vaultPath = absPath;
  }

  getVaultPath(): string | null {
    return this.vaultPath;
  }

  private get root(): string {
    if (!this.vaultPath) throw new Error("No vault open");
    return this.vaultPath;
  }

  private async invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  async pickVaultFolder(): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title: "Open vault folder" });
    return typeof picked === "string" ? picked : null;
  }

  async listTree(): Promise<FolderNode> {
    return this.invoke<FolderNode>("vault_list", { vault: this.root });
  }

  async readFile(path: string): Promise<string> {
    return this.invoke<string>("vault_read", { vault: this.root, path });
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const b64 = await this.invoke<string>("vault_read_binary", { vault: this.root, path });
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    // chunked btoa input — String.fromCharCode(...whole) overflows the arg stack
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < data.length; i += chunk) {
      bin += String.fromCharCode(...data.subarray(i, i + chunk));
    }
    await this.invoke("vault_write_binary", { vault: this.root, path, data: btoa(bin) });
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.invoke("vault_write", { vault: this.root, path, content });
  }

  async createFile(path: string, content: string): Promise<void> {
    await this.invoke("vault_create", { vault: this.root, path, content });
  }

  async createFolder(path: string): Promise<void> {
    await this.invoke("vault_mkdir", { vault: this.root, path });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.invoke("vault_rename", { vault: this.root, oldPath, newPath });
  }

  async remove(path: string): Promise<void> {
    await this.invoke("vault_delete", { vault: this.root, path });
  }

  async trash(path: string): Promise<string> {
    return this.invoke<string>("vault_trash", { vault: this.root, path });
  }

  async listTrash(): Promise<string[]> {
    return this.invoke<string[]>("vault_list_trash", { vault: this.root });
  }

  async startWatch(onChange: (paths: string[]) => void): Promise<void> {
    // re-register the event listener (a new vault may have been opened)
    this.unlistenWatch?.();
    this.unlistenWatch = null;
    const { listen } = await import("@tauri-apps/api/event");
    this.unlistenWatch = await listen<string[]>("vault:fs-change", (e) => {
      if (Array.isArray(e.payload) && e.payload.length > 0) onChange(e.payload);
    });
    await this.invoke("vault_watch", { vault: this.root });
  }

  async listPluginFiles(): Promise<Array<{ name: string; content: string }>> {
    return this.invoke<Array<{ name: string; content: string }>>("vault_plugin_files", {
      vault: this.root,
    });
  }

  async listObsidianPlugins(): Promise<ObsidianPluginSource[]> {
    return this.invoke<ObsidianPluginSource[]>("vault_obsidian_plugins", { vault: this.root });
  }

  async readConfig(relPath: string): Promise<string | null> {
    return this.invoke<string | null>("vault_read_config", { vault: this.root, path: relPath });
  }

  async writeConfig(relPath: string, content: string): Promise<void> {
    await this.invoke("vault_write_config", { vault: this.root, path: relPath, content });
  }

  async listConfigDir(relPath: string): Promise<ConfigDirEntry[]> {
    return this.invoke<ConfigDirEntry[]>("vault_list_config_dir", {
      vault: this.root,
      path: relPath,
    });
  }
}
