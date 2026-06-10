import type { FileNode, FolderNode, VaultNode } from "./types";
import { EventBus } from "./events";
import { Store } from "./store";

/**
 * VaultAdapter — the IO boundary. Two implementations:
 *  - TauriVaultAdapter: real filesystem via Tauri IPC (desktop)
 *  - MemoryVaultAdapter: in-memory demo vault (browser dev / E2E tests)
 * All paths are vault-relative, forward slashes.
 */
export interface VaultAdapter {
  readonly kind: "tauri" | "memory";
  /** show folder picker; returns absolute path or null if cancelled */
  pickVaultFolder(): Promise<string | null>;
  /** point the adapter at a vault root (absolute path; ignored by memory) */
  setVaultPath(absPath: string): void;
  getVaultPath(): string | null;
  listTree(): Promise<FolderNode>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(path: string): Promise<void>;
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

/**
 * Vault wraps an adapter with caching + events. Feature modules should use
 * this class (via AppContext), never the adapter directly.
 */
export class Vault {
  readonly tree = new Store<FolderNode | null>(null);
  private contentCache = new Map<string, string>();

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
    return this.getFiles().some((f) => f.path === path);
  }

  async load(): Promise<void> {
    const tree = await this.adapter.listTree();
    sortChildren(tree);
    this.contentCache.clear();
    this.tree.set(tree);
    this.events.emit("vault:changed", { reason: "load" });
  }

  async read(path: string): Promise<string> {
    const cached = this.contentCache.get(path);
    if (cached !== undefined) return cached;
    const content = await this.adapter.readFile(path);
    this.contentCache.set(path, content);
    return content;
  }

  /** read from cache only (sync) — may be undefined if never read */
  readCached(path: string): string | undefined {
    return this.contentCache.get(path);
  }

  async modify(path: string, content: string): Promise<void> {
    await this.adapter.writeFile(path, content);
    this.contentCache.set(path, content);
    this.events.emit("file:modified", { path });
    this.events.emit("vault:changed", { reason: "modify" });
  }

  /** Create a file; auto-creates "Untitled n.md" style unique names upstream. */
  async create(path: string, content = ""): Promise<void> {
    await this.adapter.createFile(path, content);
    this.contentCache.set(path, content);
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
    const cached = this.contentCache.get(oldPath);
    this.contentCache.delete(oldPath);
    if (cached !== undefined) this.contentCache.set(newPath, cached);
    await this.refreshTree();
    this.events.emit("file:renamed", { oldPath, newPath });
    this.events.emit("vault:changed", { reason: "rename" });
  }

  async remove(path: string): Promise<void> {
    await this.adapter.remove(path);
    // drop cache entries under this path (file or folder)
    for (const key of [...this.contentCache.keys()]) {
      if (key === path || key.startsWith(path + "/")) this.contentCache.delete(key);
    }
    await this.refreshTree();
    this.events.emit("file:deleted", { path });
    this.events.emit("vault:changed", { reason: "delete" });
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
    this.tree.set(tree);
  }
}

/* ---------------- Memory adapter (browser dev + E2E) ---------------- */

const DEMO_FILES: Record<string, string> = {
  "Welcome.md": `# Welcome to Geode 💎

Geode is a **local-first** markdown knowledge base.

- Create notes, link them with [[Wiki Links]]
- Explore connections in the [[Graph View|graph]]
- Press \`Ctrl+P\` for the command palette, \`Ctrl+O\` to quick-switch notes

Start with [[Getting Started]] or read about [[Daily Notes]].

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
};

export class MemoryVaultAdapter implements VaultAdapter {
  readonly kind = "memory" as const;
  private files = new Map<string, string>();
  private folders = new Set<string>();

  constructor(seed: Record<string, string> = DEMO_FILES) {
    for (const [path, content] of Object.entries(seed)) {
      this.files.set(path, content);
      let parent = parentPath(path);
      while (parent) {
        this.folders.add(parent);
        parent = parentPath(parent);
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
    for (const folder of this.folders) ensureFolder(folder);
    for (const path of this.files.keys()) {
      ensureFolder(parentPath(path)).children.push(makeFileNode(path));
    }
    return root;
  }

  async readFile(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`File not found: ${path}`);
    return c;
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
    this.folders.add(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
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
 */
export class TauriVaultAdapter implements VaultAdapter {
  readonly kind = "tauri" as const;
  private vaultPath: string | null = null;

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
}
