/**
 * TAbstractFile / TFile / TFolder + the canonical-instance registry
 * (API-REFERENCE area 2).
 *
 * Identity rules (calibrated):
 *  - ONE canonical instance per path; every shim API hands out the same object,
 *    so `instanceof TFile` works on anything a plugin receives.
 *  - rename MUTATES the instance in place and fires per-descendant
 *    rename(file, oldPath) (folder renames fire for the folder AND every child).
 *  - folder delete fires ONE 'delete' with the TFolder, children intact.
 *  - TFile.stat (R265): real ctime/mtime/size. Desktop reads FS metadata via the Rust
 *    listing (carried on FileNode → copied here on rebuild); memory computes size from
 *    content + tracks session ctime/mtime. Live create/modify stamp ctime/mtime + recompute
 *    size from the just-written content (a content edit doesn't re-list the tree, so the
 *    listing size would be stale until the next structural refresh).
 */
import type { FileNode, FolderNode, VaultNode } from "@core/types";
import { basename, extension, parentPath, stripExtension, type Vault as GeodeVault } from "@core/vault";
import type { Vault } from "./vault";

/** R265 — copy any tree-carried stats (FS metadata on desktop, session+size on memory). */
function applyStat(file: TFile, node: { ctime?: number; mtime?: number; size?: number }): void {
  if (node.ctime !== undefined) file.stat.ctime = node.ctime;
  if (node.mtime !== undefined) file.stat.mtime = node.mtime;
  if (node.size !== undefined) file.stat.size = node.size;
}

export interface FileStats {
  /** Time of creation, unix ms. */
  ctime: number;
  /** Time of last modification, unix ms. */
  mtime: number;
  /** Size on disk, bytes. */
  size: number;
}

export abstract class TAbstractFile {
  vault!: Vault;
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  stat: FileStats = { ctime: 0, mtime: 0, size: 0 };
  basename = "";
  extension = "";
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.path === "/";
  }
}

/* ---------------- registry ---------------- */

export class FileRegistry {
  /** geode-style path ("" excluded — root is held separately) -> canonical instance */
  private byPath = new Map<string, TAbstractFile>();
  readonly root: TFolder;
  private vaultShim: Vault | null = null;
  /** R265 — set on rebuildFromVault; used to recompute TFile.stat.size from live content. */
  private geodeVault: GeodeVault | null = null;

  constructor() {
    this.root = new TFolder();
    this.root.path = "/";
    this.root.name = "";
    this.root.parent = null;
  }

  /** Late-bind the vault shim (instances carry vault back-references). */
  attach(vault: Vault): void {
    this.vaultShim = vault;
    this.root.vault = vault;
  }

  /** R265 — UTF-8 byte size of the live (cached) content, or undefined when not cached. */
  private sizeOf(path: string): number | undefined {
    const content = this.geodeVault?.readCached(path);
    return content === undefined ? undefined : new TextEncoder().encode(content).length;
  }

  /** R265 — the current tree FileNode for a path (carries real FS stats on desktop / memory
   *  size+times). Used as the stat source when readCached is empty (external sync/git-pull edits
   *  drop the content cache before the event fires). O(tree) — only for single-file events. */
  private treeNode(path: string): FileNode | undefined {
    const root = this.geodeVault?.tree.get();
    if (!root) return undefined;
    let found: FileNode | undefined;
    const walk = (n: VaultNode): void => {
      if (found) return;
      if (n.kind === "file") {
        if (n.path === path) found = n;
      } else n.children.forEach(walk);
    };
    walk(root);
    return found;
  }

  private trigger(name: "create" | "modify" | "delete" | "rename", ...data: unknown[]): void {
    this.vaultShim?.trigger(name, ...data);
  }

  /* ----- lookups (paths are geode-style; "" or "/" means root) ----- */

  get(path: string): TAbstractFile | null {
    if (path === "" || path === "/") return this.root;
    return this.byPath.get(path) ?? null;
  }

  getFile(path: string): TFile | null {
    const node = this.get(path);
    return node instanceof TFile ? node : null;
  }

  getFolder(path: string): TFolder | null {
    const node = this.get(path);
    return node instanceof TFolder ? node : null;
  }

  files(): TFile[] {
    const out: TFile[] = [];
    for (const node of this.byPath.values()) if (node instanceof TFile) out.push(node);
    return out;
  }

  allLoadedFiles(): TAbstractFile[] {
    return [this.root, ...this.byPath.values()];
  }

  /* ----- construction ----- */

  ensureFolder(path: string, fireCreate: boolean): TFolder {
    if (!path || path === "/") return this.root;
    const existing = this.byPath.get(path);
    if (existing instanceof TFolder) return existing;
    const parent = this.ensureFolder(parentPath(path), fireCreate);
    const folder = new TFolder();
    if (this.vaultShim) folder.vault = this.vaultShim;
    folder.path = path;
    folder.name = basename(path);
    folder.parent = parent;
    parent.children.push(folder);
    this.byPath.set(path, folder);
    if (fireCreate) this.trigger("create", folder);
    return folder;
  }

  ensureFile(path: string, fireCreate: boolean, node?: FileNode): TFile {
    const existing = this.byPath.get(path);
    if (existing instanceof TFile) {
      if (node) applyStat(existing, node); // R265: rebuild refreshes stats on a known file
      return existing;
    }
    const parent = this.ensureFolder(parentPath(path), fireCreate);
    const file = new TFile();
    if (this.vaultShim) file.vault = this.vaultShim;
    file.path = path;
    file.name = basename(path);
    file.basename = stripExtension(file.name);
    file.extension = extension(file.name);
    file.parent = parent;
    parent.children.push(file);
    this.byPath.set(path, file);
    if (node) {
      applyStat(file, node); // R265: tree-carried stats (FS metadata desktop / memory size+times)
    } else if (fireCreate) {
      // live creation (no tree node) — session ctime/mtime + size from the just-written content
      file.stat.ctime = file.stat.mtime = Date.now();
      const size = this.sizeOf(path);
      if (size !== undefined) file.stat.size = size;
    }
    if (fireCreate) this.trigger("create", file);
    return file;
  }

  /** Full silent rebuild from the Geode tree (vault load / reload). */
  rebuildFromVault(geodeVault: GeodeVault): void {
    this.geodeVault = geodeVault; // R265: lets handleModified recompute size from live content
    this.byPath.clear();
    this.root.children = [];
    const tree = geodeVault.tree.get();
    if (!tree) return;
    const walk = (node: VaultNode): void => {
      if (node.kind === "folder") {
        if (node.path) this.ensureFolder(node.path, false);
        node.children.forEach(walk);
      } else {
        this.ensureFile(node.path, false, node); // R265: carry the node's stats onto TFile.stat
      }
    };
    walk(tree);
  }

  /** Add folders newly present in the tree (covers createFolder, which emits no file event). */
  reconcileFolders(tree: FolderNode | null): void {
    if (!tree) return;
    const walk = (node: VaultNode): void => {
      if (node.kind !== "folder") return;
      if (node.path) this.ensureFolder(node.path, true);
      node.children.forEach(walk);
    };
    walk(tree);
  }

  /* ----- geode event entry points (called by the compat context) ----- */

  handleCreated(path: string): void {
    if (this.byPath.get(path) instanceof TFile) return; // already known
    // R265: prefer the tree node's real stats (FS metadata / external create) when present;
    // ensureFile falls back to a session stamp + content size when the tree hasn't re-listed yet.
    this.ensureFile(path, true, this.treeNode(path));
  }

  handleModified(path: string): void {
    const node = this.get(path);
    if (node instanceof TFolder) return;
    const file = node instanceof TFile ? node : this.ensureFile(path, false);
    file.stat.mtime = Date.now();
    // R265: internal save keeps the content cache → exact new size. An EXTERNAL edit
    // (sync/git-pull) drops the cache before the event, so fall back to the re-listed tree
    // node's stat (real FS ctime/mtime/size on desktop) instead of leaving size stale.
    const size = this.sizeOf(path);
    if (size !== undefined) {
      file.stat.size = size;
    } else {
      const treeFile = this.treeNode(path);
      if (treeFile) applyStat(file, treeFile);
    }
    this.trigger("modify", file);
  }

  handleDeleted(path: string): void {
    const node = this.get(path);
    if (!node || node === this.root) return;
    // drop the node + every descendant from the map (children arrays stay intact
    // on the instance — plugins walk children of a deleted TFolder themselves)
    const removeKeys = (n: TAbstractFile): void => {
      this.byPath.delete(n.path);
      if (n instanceof TFolder) n.children.forEach(removeKeys);
    };
    removeKeys(node);
    if (node.parent) {
      const idx = node.parent.children.indexOf(node);
      if (idx >= 0) node.parent.children.splice(idx, 1);
    }
    // .parent/.path reflect pre-delete state on the delivered object
    this.trigger("delete", node);
  }

  handleRenamed(oldPath: string, newPath: string): void {
    const node = this.get(oldPath);
    if (!node || node === this.root) {
      // unknown source — treat as a fresh appearance of newPath
      this.ensureFile(newPath, true);
      return;
    }
    // capture every affected node with its OLD path before mutating
    const renames: Array<{ node: TAbstractFile; oldPath: string }> = [];
    const collect = (n: TAbstractFile, oldP: string): void => {
      renames.push({ node: n, oldPath: oldP });
      if (n instanceof TFolder) {
        for (const c of n.children) collect(c, `${oldP}/${c.name}`);
      }
    };
    collect(node, oldPath);
    for (const r of renames) this.byPath.delete(r.oldPath);

    // mutate the renamed node in place (object identity preserved)
    const newParent = this.ensureFolder(parentPath(newPath), true);
    if (node.parent && node.parent !== newParent) {
      const idx = node.parent.children.indexOf(node);
      if (idx >= 0) node.parent.children.splice(idx, 1);
      newParent.children.push(node);
    }
    node.parent = newParent;
    node.path = newPath;
    node.name = basename(newPath);
    if (node instanceof TFile) {
      node.basename = stripExtension(node.name);
      node.extension = extension(node.name);
    }
    // recompute descendant paths from their (unchanged) parents
    const reposition = (folder: TFolder): void => {
      for (const c of folder.children) {
        c.path = folder === this.root ? c.name : `${folder.path}/${c.name}`;
        if (c instanceof TFolder) reposition(c);
      }
    };
    if (node instanceof TFolder) reposition(node);
    for (const r of renames) this.byPath.set(r.node.path, r.node);

    // per-descendant rename(file, oldPath) — folder first, then children
    for (const r of renames) this.trigger("rename", r.node, r.oldPath);
  }
}
