/**
 * Obsidian Vault shim (API-REFERENCE area 2) over the Geode Vault.
 * Extends the Events shim so typed on() overloads and the generic dispatcher
 * share one mechanism. File objects always come from the canonical registry.
 */
import type { Vault as GeodeVault } from "@core/vault";
import { Events, type EventRef } from "./events";
import { FileRegistry, TAbstractFile, TFile, TFolder } from "./files";
import { reportGap } from "./gaps";

export interface DataWriteOptions {
  ctime?: number;
  mtime?: number;
}

/* ---------------- minimal DataAdapter ---------------- */

const CONFIG_PREFIX = ".obsidian/";

/**
 * Minimal DataAdapter: plain string IO. Paths under `.obsidian/` route to the
 * Geode config IO (the only sanctioned dot-folder access); everything else
 * goes through the vault adapter. Binary/stat/trash operations are gaps.
 */
export class CompatDataAdapter {
  constructor(private geode: GeodeVault) {}

  private configRel(path: string): string | null {
    if (path === ".obsidian") return "";
    return path.startsWith(CONFIG_PREFIX) ? path.slice(CONFIG_PREFIX.length) : null;
  }

  getName(): string {
    return this.geode.vaultName;
  }

  async exists(normalizedPath: string, _sensitive?: boolean): Promise<boolean> {
    const rel = this.configRel(normalizedPath);
    if (rel !== null) {
      if (rel === "") return true;
      return (await this.geode.adapter.readConfig(rel)) !== null;
    }
    return this.geode.fileExists(normalizedPath) || this.geode.folderExists(normalizedPath);
  }

  async read(normalizedPath: string): Promise<string> {
    const rel = this.configRel(normalizedPath);
    if (rel !== null) {
      const content = await this.geode.adapter.readConfig(rel);
      if (content === null) throw new Error(`File not found: ${normalizedPath}`);
      return content;
    }
    return this.geode.read(normalizedPath);
  }

  async write(normalizedPath: string, data: string, _options?: DataWriteOptions): Promise<void> {
    const rel = this.configRel(normalizedPath);
    if (rel !== null) {
      await this.geode.adapter.writeConfig(rel, data);
      return;
    }
    if (this.geode.fileExists(normalizedPath)) await this.geode.modify(normalizedPath, data);
    else await this.geode.create(normalizedPath, data);
  }

  async mkdir(normalizedPath: string): Promise<void> {
    await this.geode.createFolder(normalizedPath);
  }

  async remove(normalizedPath: string): Promise<void> {
    await this.geode.remove(normalizedPath);
  }

  async rename(normalizedPath: string, normalizedNewPath: string): Promise<void> {
    await this.geode.rename(normalizedPath, normalizedNewPath);
  }

  async append(normalizedPath: string, data: string, _options?: DataWriteOptions): Promise<void> {
    let current = "";
    try {
      current = await this.read(normalizedPath);
    } catch {
      /* missing file — append creates it */
    }
    await this.write(normalizedPath, current + data);
  }

  /** Read -> transform -> write-if-changed; returns the new content. */
  async process(
    normalizedPath: string,
    fn: (data: string) => string,
    _options?: DataWriteOptions,
  ): Promise<string> {
    const data = await this.read(normalizedPath);
    const next = fn(data);
    if (next !== data) await this.write(normalizedPath, next);
    return next;
  }

  async rmdir(normalizedPath: string, _recursive: boolean): Promise<void> {
    await this.geode.remove(normalizedPath);
  }

  async copy(normalizedPath: string, normalizedNewPath: string): Promise<void> {
    await this.write(normalizedNewPath, await this.read(normalizedPath));
  }

  async list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = normalizedPath && normalizedPath !== "/" ? `${normalizedPath}/` : "";
    const files: string[] = [];
    const folders = new Set<string>();
    for (const f of this.geode.getFiles()) {
      if (!f.path.startsWith(prefix)) continue;
      const rest = f.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) files.push(f.path);
      else folders.add(prefix + rest.slice(0, slash));
    }
    return { files, folders: [...folders] };
  }

  /* gaps — keep the surface honest instead of silently lying */
  async readBinary(_p: string): Promise<ArrayBuffer> {
    reportGap("DataAdapter", "readBinary");
    throw new Error("DataAdapter.readBinary is not available in Geode");
  }
  async writeBinary(_p: string, _d: ArrayBuffer): Promise<void> {
    reportGap("DataAdapter", "writeBinary");
    throw new Error("DataAdapter.writeBinary is not available in Geode");
  }
  async appendBinary(_p: string, _d: ArrayBuffer): Promise<void> {
    reportGap("DataAdapter", "appendBinary");
    throw new Error("DataAdapter.appendBinary is not available in Geode");
  }
  async stat(_p: string): Promise<null> {
    reportGap("DataAdapter", "stat", "returns null");
    return null;
  }
  async trashSystem(_p: string): Promise<boolean> {
    reportGap("DataAdapter", "trashSystem", "returns false");
    return false;
  }
  async trashLocal(p: string): Promise<void> {
    // R42: route to the vault's local `.trash/` (recoverable) instead of deleting
    await this.geode.trash(p);
  }
  getResourcePath(normalizedPath: string): string {
    reportGap("DataAdapter", "getResourcePath", "returns the vault-relative path");
    return normalizedPath;
  }
}

export type DataAdapter = CompatDataAdapter;

/* ---------------- Vault ---------------- */

export class Vault extends Events {
  /** 'typically `.obsidian` but it could be different' — Geode always uses .obsidian */
  configDir = ".obsidian";
  readonly adapter: CompatDataAdapter;
  /** @internal */
  readonly _geode: GeodeVault;
  /** @internal */
  readonly _registry: FileRegistry;
  /** per-file chains keeping process() atomic under concurrency */
  private locks = new Map<string, Promise<unknown>>();

  constructor(geodeVault: GeodeVault, registry: FileRegistry) {
    super();
    this._geode = geodeVault;
    this._registry = registry;
    this.adapter = new CompatDataAdapter(geodeVault);
  }

  getName(): string {
    return this._geode.vaultName;
  }

  getRoot(): TFolder {
    return this._registry.root;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this._registry.get(path);
  }

  getFileByPath(path: string): TFile | null {
    return this._registry.getFile(path);
  }

  getFolderByPath(path: string): TFolder | null {
    return this._registry.getFolder(path);
  }

  getMarkdownFiles(): TFile[] {
    return this._registry.files().filter((f) => f.extension === "md");
  }

  getFiles(): TFile[] {
    return this._registry.files();
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return this._registry.allLoadedFiles();
  }

  getAllFolders(includeRoot?: boolean): TFolder[] {
    const out: TFolder[] = includeRoot ? [this._registry.root] : [];
    for (const node of this._registry.allLoadedFiles()) {
      if (node instanceof TFolder && node !== this._registry.root) out.push(node);
    }
    return out;
  }

  static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => unknown): void {
    cb(root);
    for (const child of root.children) {
      if (child instanceof TFolder) Vault.recurseChildren(child, cb);
      else cb(child);
    }
  }

  /* ----- IO ----- */

  async read(file: TFile): Promise<string> {
    return this._geode.read(file.path);
  }

  async cachedRead(file: TFile): Promise<string> {
    return this._geode.readCached(file.path) ?? this._geode.read(file.path);
  }

  async create(path: string, data: string, _options?: DataWriteOptions): Promise<TFile> {
    await this._geode.create(path, data);
    // the registry handler (file:created) fires synchronously during create
    return this._registry.getFile(path) ?? this._registry.ensureFile(path, true);
  }

  async createFolder(path: string): Promise<TFolder> {
    await this._geode.createFolder(path);
    return this._registry.ensureFolder(path, true);
  }

  async modify(file: TFile, data: string, _options?: DataWriteOptions): Promise<void> {
    await this._geode.modify(file.path, data);
  }

  async append(file: TFile, data: string, _options?: DataWriteOptions): Promise<void> {
    const current = await this._geode.read(file.path);
    await this._geode.modify(file.path, current + data);
  }

  /** 'Atomically read, modify, and save' — serialized per file. */
  async process(
    file: TFile,
    fn: (data: string) => string,
    _options?: DataWriteOptions,
  ): Promise<string> {
    const prev = this.locks.get(file.path) ?? Promise.resolve();
    const task = prev
      .catch(() => undefined)
      .then(async () => {
        const data = await this._geode.read(file.path);
        const next = fn(data);
        if (next !== data) await this._geode.modify(file.path, next);
        return next;
      });
    this.locks.set(file.path, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(file.path) === task) this.locks.delete(file.path);
    }
  }

  async delete(file: TAbstractFile, _force?: boolean): Promise<void> {
    await this._geode.remove(file.path);
  }

  /**
   * R42: local trash (`system === false`) routes to the vault's `.trash/`
   * (recoverable). System trash (`system === true`) is not implemented in
   * Geode — recorded as a gap and falls back to the local trash.
   */
  async trash(file: TAbstractFile, system: boolean): Promise<void> {
    if (system) {
      reportGap("Vault", "trash(system)", "no system trash — uses local .trash/ instead");
    }
    await this._geode.trash(file.path);
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    await this._geode.rename(file.path, newPath);
  }

  async copy<T extends TAbstractFile>(file: T, newPath: string): Promise<T> {
    if (file instanceof TFile) {
      const data = await this._geode.read(file.path);
      await this._geode.create(newPath, data);
      return (this._registry.getFile(newPath) ??
        this._registry.ensureFile(newPath, true)) as unknown as T;
    }
    reportGap("Vault", "copy(TFolder)", "only file copies are supported");
    throw new Error("Vault.copy of folders is not available in Geode");
  }

  getResourcePath(file: TFile): string {
    reportGap("Vault", "getResourcePath", "returns the vault-relative path");
    return file.path;
  }

  /**
   * NON-PUBLIC API that suite plugins call directly (calendar/nldates).
   * Fixed defaults; every key is recorded as a gap once.
   */
  getConfig(key: string): unknown {
    reportGap("Vault", `getConfig("${key}")`, "non-public API — fixed default returned");
    if (key === "defaultViewMode") return "source";
    if (key === "useMarkdownLinks") return false;
    return undefined;
  }

  /* ----- typed event overloads ----- */

  on(name: "create", callback: (file: TAbstractFile) => unknown, ctx?: unknown): EventRef;
  on(name: "modify", callback: (file: TAbstractFile) => unknown, ctx?: unknown): EventRef;
  on(name: "delete", callback: (file: TAbstractFile) => unknown, ctx?: unknown): EventRef;
  on(
    name: "rename",
    callback: (file: TAbstractFile, oldPath: string) => unknown,
    ctx?: unknown,
  ): EventRef;
  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef;
  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef {
    return super.on(name, callback, ctx);
  }
}
