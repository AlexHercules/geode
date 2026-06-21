/**
 * Obsidian Plugin base class + App shim + SettingTab/PluginSettingTab
 * (API-REFERENCE area 1).
 */
import type { Extension } from "@codemirror/state";
import { bookmarks, type BookmarkItem, serializeItem } from "@core/bookmarks";
import { getCommandName, type CommandRegistry } from "@core/commands";
import { dailyNoteFolder, dailyNoteFormat, dailyNoteTemplate } from "@core/dailyNote";
import { registerEditorExtension as registerCoreEditorExtension } from "@core/editorExtensions";
import { basename, stripExtension } from "@core/vault";
import {
  makeCodeBlockPostProcessor,
  registerCodeBlockProcessor as registerCoreCodeBlockProcessor,
  type MarkdownPostProcessor,
  type MarkdownPostProcessorContext,
  registerMarkdownPostProcessor as registerCoreMarkdownPostProcessor,
} from "@core/markdownPostProcessors";
import { encodeMdHref, formatLink, linkUseMarkdown } from "@core/linkFormat";
import { renameWithLinkUpdate } from "@core/linkRewrite";
import type { AppHandle, PluginManager } from "@core/plugins";
import {
  buildRemoveProperty,
  buildSetProperty,
  parseProperties,
  type PropertyEdit,
  type PropertyValue,
} from "@core/properties";
import type { Command as GeodeCommand } from "@core/types";
import { attachmentFolder, resolveAttachmentDir } from "@core/attachments";
import { resolveNewNoteFolder } from "@core/newNote";
import { Component } from "./component";
import type { Editor } from "./editor";
import type { FileRegistry, TFolder } from "./files";
import { reportGap } from "./gaps";
import { getIconSvg, type IconName } from "./icons";
import type { MetadataCache } from "./metadata";
import type { EditorSuggest, EditorSuggestManager } from "./suggest";
import { Scope } from "./ui";
import { normalizePath } from "./util";
import type { Vault } from "./vault";
import {
  makeActiveMarkdownView,
  type MarkdownView,
  type ViewCreator,
  type Workspace,
} from "./workspace";

export type Modifier = "Mod" | "Ctrl" | "Meta" | "Shift" | "Alt";

export interface Hotkey {
  modifiers: Modifier[];
  key: string;
}

export interface Command {
  id: string;
  name: string;
  icon?: IconName;
  mobileOnly?: boolean;
  repeatable?: boolean;
  callback?: () => unknown;
  checkCallback?: (checking: boolean) => boolean | void;
  editorCallback?: (editor: Editor, ctx: MarkdownView) => unknown;
  editorCheckCallback?: (checking: boolean, editor: Editor, ctx: MarkdownView) => boolean | void;
  hotkeys?: Hotkey[];
}

export interface PluginManifest {
  /** Vault path to the plugin folder in the config directory (runtime-injected). */
  dir?: string;
  id: string;
  name: string;
  author: string;
  version: string;
  minAppVersion: string;
  description: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
}

/** @internal everything a shim instance needs from the host app */
export interface GeodeBridge {
  handle: Omit<AppHandle, "ui">;
  plugins: PluginManager;
  registry: FileRegistry;
}

/* ---------------- fileManager.processFrontMatter (real since R22) ---------------- */

/** Apply a single splice to a string (mirror of the panel's edit application). */
function spliceText(text: string, edit: PropertyEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/**
 * Validate a value the plugin callback wrote into the frontmatter object.
 * Frozen R22 contract: anything outside PropertyValue (nested objects,
 * functions, non-finite numbers, non-string array items, symbols, bigints)
 * throws TypeError — we NEVER silently serialize broken YAML. (Deviation from
 * the official full-YAML serializer, recorded in the round report.)
 */
function validateFrontmatterValue(key: string, v: unknown): PropertyValue {
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new TypeError(
        `[obsidian-compat] processFrontMatter: non-finite number for "${key}" cannot be serialized as YAML`,
      );
    }
    return v;
  }
  if (Array.isArray(v)) {
    for (const item of v as unknown[]) {
      if (typeof item !== "string") {
        throw new TypeError(
          `[obsidian-compat] processFrontMatter: list "${key}" contains a non-string item — only string[] lists can be serialized`,
        );
      }
    }
    return v as string[];
  }
  throw new TypeError(
    `[obsidian-compat] processFrontMatter: value for "${key}" has unsupported type ${typeof v} — only string/number/boolean/string[]/null can be serialized`,
  );
}

/** Shallow equality on PropertyValue (arrays compared element-wise). */
function samePropertyValue(a: PropertyValue, b: PropertyValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => x === b[i])
    );
  }
  return a === b;
}

/**
 * Real `fileManager.processFrontMatter` (official d.ts:2954): read the note,
 * expose its frontmatter as a plain JS object, run the synchronous mutator,
 * then write back ONLY the changed entries as byte-preserving splices.
 *
 * - Text source is the R16 dual path: an open buffer (documents.get) is the
 *   source of truth; otherwise the disk is read fresh (never the content
 *   cache).
 * - Only VISIBLE parseProperties entries enter the object; opaque entries
 *   (nested maps, |/> scalars, duplicate keys, comments) never appear and are
 *   never rewritten (recorded deviation from the official full-YAML object).
 * - Diff: deleted keys → buildRemoveProperty; new/changed keys →
 *   buildSetProperty in assignment (Object.keys) order. Every edit is rebuilt
 *   against the previous step's text; a null builder result aborts the whole
 *   call with zero bytes written. Zero changes → zero writes.
 * - An unparseable/absent block yields an EMPTY object and fn still runs (the
 *   official @throws YAMLParseError has no equivalent here — parseProperties
 *   degrades to all-opaque instead of failing; recorded deviation).
 */
async function doProcessFrontMatter(
  handle: Omit<AppHandle, "ui">,
  file: { path: string },
  fn: (frontmatter: Record<string, unknown>) => void,
): Promise<void> {
  const path = typeof file?.path === "string" ? file.path : null;
  if (path === null || !/\.md$/i.test(path)) {
    throw new Error(
      `[obsidian-compat] processFrontMatter: "${String(path)}" is not a Markdown file`,
    );
  }
  const { vault, documents } = handle;
  const doc = documents.get(path);
  // From here on the open-buffer path is fully SYNCHRONOUS until the edits are
  // applied, so the buffer cannot change under our offsets.
  const content = doc !== null ? doc.getText() : await vault.readFresh(path);

  // Visible entries → plain object (null prototype: no pollution, `in` is own-only).
  const frontmatter: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const original = new Map<string, PropertyValue>();
  const parsed = parseProperties(content);
  if (parsed !== null) {
    for (const entry of parsed.entries) {
      if (entry.opaque) continue;
      // independent array copies: fn may mutate in place (push/splice) and the
      // diff below must still see the pre-mutation value
      frontmatter[entry.key] = Array.isArray(entry.value) ? [...entry.value] : entry.value;
      original.set(entry.key, Array.isArray(entry.value) ? [...entry.value] : entry.value);
    }
  }

  fn(frontmatter); // synchronous mutator; a throw rejects this promise as-is (official contract)

  // Diff → ordered plan: deletions first, then new/changed keys in
  // assignment order (Object.keys). Validation happens BEFORE any write so a
  // TypeError can never leave a half-applied note.
  const plan: Array<
    { kind: "remove"; key: string } | { kind: "set"; key: string; value: PropertyValue }
  > = [];
  for (const key of original.keys()) {
    if (!(key in frontmatter)) plan.push({ kind: "remove", key });
  }
  for (const key of Object.keys(frontmatter)) {
    const raw = frontmatter[key];
    if (raw === undefined) continue; // frozen: undefined ≙ untouched, never a delete
    const value = validateFrontmatterValue(key, raw);
    if (original.has(key) && samePropertyValue(original.get(key) ?? null, value)) continue;
    plan.push({ kind: "set", key, value });
  }
  if (plan.length === 0) return; // zero changes → zero writes

  // Rebuild each splice against the PREVIOUS step's text; abort everything on
  // the first null (conflicting/opaque/unsafe) — never a partial write.
  let next = content;
  const steps: PropertyEdit[] = [];
  for (const op of plan) {
    const edit =
      op.kind === "remove"
        ? buildRemoveProperty(next, op.key)
        : buildSetProperty(next, op.key, op.value);
    if (edit === null) {
      throw new Error(
        `[obsidian-compat] processFrontMatter: cannot safely ${op.kind} property "${op.key}" (conflicting or opaque entry) — no changes written`,
      );
    }
    steps.push(edit);
    next = spliceText(next, edit);
  }
  if (next === content) return;

  if (doc !== null) {
    // applyExternalEdits expects coordinates valid for the buffer AT CALL
    // TIME; our steps were each computed against the previous step's result,
    // so they are applied ONE CALL PER STEP (still one synchronous task: the
    // buffer text tracks `next` exactly between calls). Each call lands as a
    // local edit: dirty + debounced save + shared undo history.
    for (const edit of steps) doc.applyExternalEdits([edit]);
  } else {
    await vault.modify(path, next); // echo-fingerprint suppression included
  }
}

/**
 * fileManager shim: `renameFile` is real since R16 (rename + link rewrite via
 * the core engine, matching the official "update all links" semantics — the
 * official Vault.rename stays a bare rename by design), `processFrontMatter`
 * is real since R22 (read-mutate-splice on the properties model, see
 * doProcessFrontMatter), `generateMarkdownLink` is real since R112
 * (delegates to core formatLink — honors link settings, resolve-back verified),
 * and `getAvailablePathForAttachment` / `getNewFileParent` are real since R-D12
 * (reuse the core attachment-folder + new-note-location resolvers, so they honour
 * the same user settings the host uses). Every OTHER method access records a gap
 * and resolves to undefined, so chained calls do not crash. `then` is excluded so
 * the proxy is not accidentally thenable.
 *
 * `registry` lets getNewFileParent return a live TFolder instance (compat-internal
 * signature change, not a cross-module contract).
 */
function makeFileManager(handle: Omit<AppHandle, "ui">, registry: FileRegistry): unknown {
  // Official signature returns Promise<void>; the rewrite report is dropped.
  // `file` is duck-typed: any TAbstractFile-shaped object with a vault path.
  const renameFile = async (file: { path: string }, newPath: string): Promise<void> => {
    const { vault, metadata, documents } = handle;
    await renameWithLinkUpdate({ vault, metadata, documents }, file.path, normalizePath(newPath));
  };
  // "Atomically read, modify, and save": calls are serialized through a
  // promise chain (R20 opChain precedent) so two concurrent closed-file
  // calls can never interleave their read-modify-write. `options`
  // (DataWriteOptions mtime/ctime) is ignored — recorded gap, no reportGap
  // per the R22 contract. Rejections propagate to the caller but never
  // poison the chain.
  let pfmChain: Promise<void> = Promise.resolve();
  const processFrontMatter = (
    file: { path: string },
    fn: (frontmatter: Record<string, unknown>) => void,
    _options?: unknown,
  ): Promise<void> => {
    const result = pfmChain.then(() => doProcessFrontMatter(handle, file, fn));
    pfmChain = result.catch(() => undefined);
    return result;
  };
  // R112: real `generateMarkdownLink` (official d.ts: `(file, sourcePath, subpath?,
  // alias?) => string`). Delegates to core `formatLink`, which honors the user's
  // link settings (wikilink vs markdown, shortest/relative/absolute) and is
  // resolve-back verified. `subpath` carries Obsidian's leading `#` (formatLink
  // re-adds it); an empty-string alias means "use the file name" (→ undefined).
  // formatLink returns null only when no safe resolve-back form exists; Obsidian
  // always returns a string, so degrade to a best-effort basename link.
  const generateMarkdownLink = (
    file: { path: string },
    sourcePath: string,
    subpath?: string,
    alias?: string,
  ): string => {
    const target = normalizePath(file.path);
    const sub = subpath ? subpath.replace(/^#/, "") : undefined;
    const al = alias ? alias : undefined;
    const link = formatLink(handle.metadata, target, sourcePath, { subpath: sub, alias: al });
    if (link !== null) return link;
    const base = target.slice(target.lastIndexOf("/") + 1);
    const linktext = /\.md$/i.test(base) ? base.replace(/\.md$/i, "") : base;
    if (linkUseMarkdown.get()) {
      // mirror formatLink: the markdown subpath fragment is %-encoded (href group is
      // [^\s)]+); the wikilink branch below keeps it raw (spaces are valid in [[..]]).
      const subMd = sub ? `#${encodeMdHref(sub)}` : "";
      return `[${al ?? linktext}](${encodeMdHref(target)}${subMd})`;
    }
    const inner = linktext + (sub ? `#${sub}` : "");
    return al !== undefined && al !== linktext ? `[[${inner}|${al}]]` : `[[${inner}]]`;
  };
  // R-D12: official d.ts:2967 — "Resolves a unique path for the attachment file
  // being saved. Ensures that the parent directory exists and dedupes the
  // filename if the destination filename already exists." We reuse the SAME core
  // resolvers the host uses: resolveAttachmentDir (Obsidian attachmentFolderPath
  // semantics) over the live attachmentFolder Store, plus vault.uniquePath for the
  // collision suffix ("X.png" → "X 1.png"). sourcePath defaults to the active
  // file's path (core workspace.getActiveFile() is already a path string | null).
  // The parent dir is created idempotently (try/catch — createNewNote precedent at
  // core/newNote.ts:84) before the unique-path probe so the caller's write lands.
  // No case-insensitive dedupe: Obsidian's official behaviour is plain dedupe only
  // (case-insensitive is layered higher up in core importAttachment, not here).
  const getAvailablePathForAttachment = async (
    filename: string,
    sourcePath?: string,
  ): Promise<string> => {
    const notePath = sourcePath ?? handle.workspace.getActiveFile() ?? "";
    const dir = resolveAttachmentDir(notePath, attachmentFolder.get());
    const dot = filename.lastIndexOf(".");
    // No dot, or a leading dot only (".gitignore") → treat the whole name as the stem.
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot + 1) : "";
    if (dir) {
      try {
        await handle.vault.createFolder(dir);
      } catch {
        /* folder already exists (createFolder is create_dir_all-style) — fine */
      }
    }
    return handle.vault.uniquePath(dir, stem, ext);
  };
  // R-D12: official d.ts:2893 — the folder a new file should be created in given
  // the focused file's path. We map it onto the R89 "default location for new
  // notes" setting via resolveNewNoteFolder, then resolve a live TFolder from the
  // registry (getFolder, not get — get() can return a TFile when a same-named file
  // shadows the path; we always hand back a folder). ensureFolder materialises a
  // not-yet-created folder so the return is never null — fireCreate=false because
  // this is a pure QUERY ("where would a new file go"), not a mutation: it must NOT
  // broadcast a vault create event for a folder that was never created on disk (R174
  // review: phantom create misleads folder-watching plugins; Obsidian fires nothing).
  // `newFilePath` (extension-based inference) is not consulted — Geode has a single
  // new-note location setting, no per-extension routing (recorded gap, no crash).
  const getNewFileParent = (sourcePath: string, _newFilePath?: string): TFolder => {
    const folderPath = resolveNewNoteFolder(sourcePath || null);
    return registry.getFolder(folderPath) ?? registry.ensureFolder(folderPath, false);
  };
  return new Proxy(
    {},
    {
      get(_target, prop): unknown {
        if (typeof prop !== "string" || prop === "then") return undefined;
        if (prop === "renameFile") return renameFile;
        if (prop === "processFrontMatter") return processFrontMatter;
        if (prop === "generateMarkdownLink") return generateMarkdownLink;
        if (prop === "getAvailablePathForAttachment") return getAvailablePathForAttachment;
        if (prop === "getNewFileParent") return getNewFileParent;
        reportGap("App", `fileManager.${prop}`, "no-op stub — resolves to undefined");
        return async () => undefined;
      },
    },
  );
}

/** Obsidian-shaped command for plugin consumption: a plain id/name (string) + the
 *  executable callback. Geode flattens checkCallback/editorCallback into
 *  callback+available, so the *Callback variants are not reconstructable here
 *  (documented gap); `hotkeys` is empty (Geode stores a single host hotkey string). */
interface CompatCommand {
  id: string;
  name: string;
  callback: () => void;
  hotkeys: never[];
}

/**
 * `app.commands` shim (R113 + R118) over the core CommandRegistry — the de-facto API
 * for cross-plugin command invocation. Command names are i18n thunks internally (R8) →
 * resolved to strings for plugins. executeCommandById/executeCommand respect `available`
 * (Obsidian pre-runs checkCallback(true) and returns false WITHOUT executing when the
 * command is unavailable). R118 adds findCommand / executeCommand / editorCommands.
 * NOTE executeCommand(command) routes by `command.id` back through the registry (so it
 * honors `available` and runs the registered command) rather than invoking a passed-in,
 * possibly-unregistered Command object directly — fine for the normal flow where the
 * object came from findCommand/commands/listCommands.
 * R121 adds removeCommand (app-level remove-by-id via core CommandRegistry.removeById);
 * distinct from Plugin.removeCommand, which removes a plugin's OWN command via its disposer.
 */
function makeCommands(registry: CommandRegistry): {
  executeCommandById(id: string): boolean;
  executeCommand(command: { id: string }): boolean;
  findCommand(id: string): CompatCommand | undefined;
  removeCommand(id: string): void;
  listCommands(): CompatCommand[];
  readonly commands: Record<string, CompatCommand>;
  readonly editorCommands: Record<string, CompatCommand>;
} {
  const toCompat = (c: GeodeCommand): CompatCommand => ({
    id: c.id,
    name: getCommandName(c),
    callback: c.callback,
    hotkeys: [],
  });
  const find = (id: string): GeodeCommand | undefined => registry.list().find((c) => c.id === id);
  const executeById = (id: string): boolean => {
    const cmd = find(id);
    if (!cmd || cmd.available?.() === false) return false;
    cmd.callback();
    return true;
  };
  return {
    executeCommandById: executeById,
    executeCommand: (command: { id: string }): boolean => executeById(command.id),
    findCommand: (id: string): CompatCommand | undefined => {
      const cmd = find(id);
      return cmd ? toCompat(cmd) : undefined;
    },
    // R121: Obsidian returns void; the registry's boolean (unknown id → false) is dropped.
    removeCommand: (id: string): void => {
      registry.removeById(id);
    },
    listCommands: (): CompatCommand[] => registry.list().map(toCompat),
    get commands(): Record<string, CompatCommand> {
      const out: Record<string, CompatCommand> = {};
      for (const c of registry.list()) out[c.id] = toCompat(c);
      return out;
    },
    /** Geode has no separately-tracked editor-scoped command set (editorCallback commands
     *  flatten into the unified registry), so editorCommands is always empty — accessing it
     *  never throws; Geode's editor commands appear in `commands`/`listCommands` instead. */
    get editorCommands(): Record<string, CompatCommand> {
      return {};
    },
  };
}

const keymapStub = {
  pushScope(_scope: unknown): void {},
  popScope(_scope: unknown): void {},
};

const dragManagerStub = {
  dragFile: (): null => null,
  onDragStart: (): void => {},
};

/* R158: `app.internalPlugins.getPluginById("bookmarks").instance` — the de-facto (non-public,
 * not in d.ts) programmatic bookmarks API that plugins use to read/mutate bookmarks. Backed by
 * R27's native bookmark store (same `.obsidian/bookmarks.json`); writes delegate to the vetted,
 * serialized `bookmarks.add`/`removeAt` (no new write path). Items are already Obsidian-shaped. */

/** Stable identity for an item by its discriminating fields (value-match, not reference — the
 *  Store rebuilds items on reload). */
function bookmarkKey(item: BookmarkItem): string {
  switch (item.type) {
    case "file":
    case "folder":
      return `${item.type}:${item.path}`;
    case "heading":
    case "block":
      return `${item.type}:${item.path}:${item.subpath}`;
    case "search":
      return `search:${item.query}`;
    default: // graph / group — no path; fall back to the (optional) title
      return `${item.type}:${item.title ?? ""}`;
  }
}

/** Index-path of the item matching `key` within the (possibly nested) tree, or null. */
function bookmarkPath(items: readonly BookmarkItem[], key: string, prefix: number[] = []): number[] | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const here = [...prefix, i];
    if (bookmarkKey(item) === key) return here;
    if (item.type === "group") {
      const found = bookmarkPath(item.items, key, here);
      if (found) return found;
    }
  }
  return null;
}

/** Obsidian's `instance.getItemTitle(item)` — display label (no i18n; the panel's richer
 *  localized version is feature-local and can't cross the layering boundary). */
function bookmarkItemTitle(item: BookmarkItem): string {
  if (item.title) return item.title;
  switch (item.type) {
    case "file":
      // a note's display title strips the extension (Obsidian TFile.basename / the panel)
      return stripExtension(basename(item.path)) || item.path;
    case "folder":
      return basename(item.path) || item.path;
    case "heading":
    case "block":
      return `${stripExtension(basename(item.path))} ${item.subpath}`;
    case "search":
      return item.query;
    default:
      return item.type;
  }
}

const bookmarksInstance = {
  // canonical Obsidian wire shape (defensive copies; unknown-type carriers reconstructed)
  getBookmarks: (): BookmarkItem[] => bookmarks.items.get().map((i) => serializeItem(i) as unknown as BookmarkItem),
  getItemTitle: (item: BookmarkItem): string => bookmarkItemTitle(item),
  addItem: (item: BookmarkItem): void => {
    void bookmarks.add(item);
  },
  removeItem: (item: BookmarkItem): void => {
    const path = bookmarkPath(bookmarks.items.get(), bookmarkKey(item));
    if (path) void bookmarks.removeAt(path);
  },
};
const bookmarksPlugin = { enabled: true, instance: bookmarksInstance };

/* R159: `app.internalPlugins.getPluginById("daily-notes").instance.options` — the de-facto config
 * (folder/format/template) that obsidian-daily-notes-interface reads (Calendar / Periodic Notes
 * depend on it). A live getter over R48's daily-note setting Stores; READ-ONLY (no writes). */
const dailyNotesInstance = {
  get options() {
    return {
      folder: dailyNoteFolder.get(), // RAW like Obsidian's instance.options (the consumer trims)
      format: dailyNoteFormat.get(), // moment format — same lib as Obsidian
      template: dailyNoteTemplate.get(),
      autorun: false, // Geode has no "open daily note on startup" setting
    };
  },
};
const dailyNotesPlugin = { enabled: true, instance: dailyNotesInstance };

const internalPluginsRecord: Record<string, { enabled: boolean; instance: unknown }> = {
  bookmarks: bookmarksPlugin,
  "daily-notes": dailyNotesPlugin,
};

const internalPluginsStub = {
  // Object.hasOwn guard so getPluginById("toString")/("__proto__") don't resolve a prototype member
  getEnabledPluginById: (id: string): unknown =>
    Object.hasOwn(internalPluginsRecord, id) ? internalPluginsRecord[id].instance : null,
  getPluginById: (id: string): { enabled: boolean; instance: unknown } | null =>
    Object.hasOwn(internalPluginsRecord, id) ? internalPluginsRecord[id] : null,
  /** F6: calendar destructures app.internalPlugins.plugins["daily-notes"] */
  plugins: internalPluginsRecord,
};

const pluginsStub = {
  getPlugin: (): null => null,
  enabledPlugins: new Set<string>(),
  plugins: {},
};

export class App {
  vault: Vault;
  workspace: Workspace;
  metadataCache: MetadataCache;
  /** @internal geode bridge — NOT part of the public obsidian surface */
  readonly _geode: GeodeBridge;
  /** @internal EditorSuggest runtime — injected by context.ts after App is built */
  _suggests: EditorSuggestManager | null = null;
  private _scopeStub: Scope | null = null;
  private _fileManager: unknown = null;
  private _commands: ReturnType<typeof makeCommands> | null = null;

  constructor(bridge: GeodeBridge, vault: Vault, workspace: Workspace, metadataCache: MetadataCache) {
    this._geode = bridge;
    this.vault = vault;
    this.workspace = workspace;
    this.metadataCache = metadataCache;
  }

  /* ----- per-vault localStorage + theme (R129) — real, not stubs ----- */

  /** R129: vault-namespaced localStorage key. Obsidian scopes these per vault so two vaults never
   *  clobber each other's UI state; we key on the vault name (geode.vaultName). Both parts are
   *  encodeURIComponent'd so a `:` inside the name or the plugin key can't blur the delimiter.
   *  Known limitation (UI-state-only, benign): two vaults that share a basename, or a renamed vault
   *  folder, share/orphan this store — Geode has no stable per-vault id (real plugin data goes
   *  through saveData→data.json, unaffected). */
  private localStorageKey(key: string): string {
    return `geode-ls:${encodeURIComponent(this.vault.getName())}:${encodeURIComponent(key)}`;
  }

  /** Retrieve a vault-specific value previously stored with saveLocalStorage (JSON round-trip);
   *  null when absent. A non-JSON legacy value is returned verbatim. */
  loadLocalStorage(key: string): unknown {
    const raw = localStorage.getItem(this.localStorageKey(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /** Save a vault-specific value (JSON-serialized). null/undefined clears the entry (Obsidian口径:
   *  "if data is null, the entry will be cleared"). */
  saveLocalStorage(key: string, value: unknown): void {
    if (value === null || value === undefined) localStorage.removeItem(this.localStorageKey(key));
    else localStorage.setItem(this.localStorageKey(key), JSON.stringify(value));
  }

  /** Whether the active theme is dark — reads the resident body class themes.ts keeps in sync. */
  isDarkMode(): boolean {
    return document.body.classList.contains("theme-dark");
  }

  /* ----- out-of-tier App members: warn-stubs, never a crash (T2 gaps) ----- */

  /** renameFile (R16) + processFrontMatter (R22) + generateMarkdownLink (R112) +
   *  getAvailablePathForAttachment/getNewFileParent (R-D12) are real; other methods
   *  gap per access. */
  get fileManager(): unknown {
    return (this._fileManager ??= makeFileManager(this._geode.handle, this._geode.registry));
  }

  /** app.commands (R113): executeCommandById/listCommands/commands over the core
   *  CommandRegistry — real, not a stub. The de-facto cross-plugin command API. */
  get commands(): ReturnType<typeof makeCommands> {
    return (this._commands ??= makeCommands(this._geode.handle.commands));
  }

  get keymap(): typeof keymapStub {
    reportGap("App", "App.keymap", "warn-stub — pushScope/popScope are no-ops");
    return keymapStub;
  }

  get scope(): Scope {
    reportGap("App", "App.scope", "detached Scope — the host never dispatches it");
    return (this._scopeStub ??= new Scope());
  }

  get dragManager(): typeof dragManagerStub {
    reportGap("App", "App.dragManager", "warn-stub — dragFile/onDragStart are no-ops");
    return dragManagerStub;
  }

  get internalPlugins(): typeof internalPluginsStub {
    reportGap("App", "App.internalPlugins", 'R158/R159: "bookmarks" (getBookmarks/addItem/removeItem) + "daily-notes" (instance.options) return real instances; other ids → null');
    return internalPluginsStub;
  }

  get plugins(): typeof pluginsStub {
    reportGap("App", "App.plugins", "warn-stub — getPlugin returns null, enabledPlugins is empty");
    return pluginsStub;
  }

  /** Matches the official `UserEvent | null` — no user-event tracking (no gap). */
  get lastEvent(): null {
    return null;
  }
}

/** Map an obsidian Hotkey to Geode's "Ctrl+Shift+X" string (Mod => Ctrl). */
function hotkeyToString(hotkey: Hotkey | undefined): string | null {
  if (!hotkey) return null;
  if (hotkey.modifiers.includes("Meta")) return null; // no Meta handling on the host
  const mods = hotkey.modifiers.map((m) => (m === "Mod" ? "Ctrl" : m));
  return [...mods, hotkey.key].join("+");
}

function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

export abstract class Plugin extends Component {
  app: App;
  manifest: PluginManifest;
  /** Plugin settings (assign loaded data here in onload). */
  settings?: unknown;
  private _uiCounter = 0;
  private _commandDisposers = new Map<string, () => void>();
  /** R25: hover link source ids registered via registerHoverLinkSource (no-op registry). */
  private _hoverLinkSources = new Set<string>();

  constructor(app: App, manifest: PluginManifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }

  override onload(): Promise<void> | void {}

  /* ----- commands ----- */

  /**
   * 'The command id and name will be automatically prefixed with this plugin's
   * id and name.' Precedence: editorCheckCallback > editorCallback >
   * checkCallback > callback; checking-mode calls must be side-effect free.
   */
  addCommand(command: Command): Command {
    const bridge = this.app._geode;
    // active-pane facade leaf via the workspace so the view carries leaf._app
    const getView = () =>
      makeActiveMarkdownView(bridge.handle, bridge.registry, this.app.workspace.getLeaf(false));
    let callback: (() => void) | null = null;
    let available: (() => boolean) | undefined;

    if (command.editorCheckCallback) {
      const cb = command.editorCheckCallback;
      available = () => {
        const view = getView();
        return view !== null && cb(true, view.editor, view) === true;
      };
      callback = () => {
        const view = getView();
        if (view) cb(false, view.editor, view);
      };
    } else if (command.editorCallback) {
      const cb = command.editorCallback;
      available = () => getView() !== null;
      callback = () => {
        const view = getView();
        if (view) cb(view.editor, view);
      };
    } else if (command.checkCallback) {
      const cb = command.checkCallback;
      available = () => cb(true) === true;
      callback = () => {
        cb(false);
      };
    } else if (command.callback) {
      const cb = command.callback;
      callback = () => {
        cb();
      };
    }
    if (!callback) {
      console.warn(`[obsidian-compat] ${this.manifest.id}: command "${command.id}" has no callback`);
      return command;
    }

    const geodeCommand: GeodeCommand = {
      id: `${this.manifest.id}:${command.id}`,
      name: `${this.manifest.name}: ${command.name}`,
      callback,
    };
    if (available) geodeCommand.available = available;
    // bind the first host-representable hotkey; record every dropped one
    // (Meta-based, or beyond the single host hotkey slot) as a gap
    let hotkey: string | null = null;
    for (const h of command.hotkeys ?? []) {
      const mapped = hotkeyToString(h);
      if (mapped !== null && hotkey === null) {
        hotkey = mapped;
        continue;
      }
      reportGap(
        this.manifest.id,
        "Command.hotkeys",
        `"${command.id}": hotkey ${JSON.stringify(h)} not bindable on host (${
          mapped === null ? "Meta modifier unsupported" : "single hotkey slot"
        })`,
      );
    }
    if (hotkey) geodeCommand.hotkey = hotkey;

    const dispose = once(bridge.handle.commands.register(geodeCommand));
    this._commandDisposers.set(command.id, dispose);
    this.register(dispose);
    return command;
  }

  /** Takes the UN-prefixed command id. */
  removeCommand(commandId: string): void {
    this._commandDisposers.get(commandId)?.();
    this._commandDisposers.delete(commandId);
  }

  /* ----- UI contributions ----- */

  /** 'Adds a ribbon icon to the left bar.' Returns the created element. */
  addRibbonIcon(icon: IconName, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
    const el = document.createElement("div");
    el.className = "clickable-icon side-dock-ribbon-action geode-compat-ribbon";
    el.setAttribute("aria-label", title);
    el.setAttribute("data-testid", `compat-ribbon-${this.manifest.id}`);
    const svg = getIconSvg(icon);
    if (svg) el.innerHTML = svg;
    else el.textContent = (title || icon).slice(0, 1).toUpperCase();
    el.addEventListener("click", (evt) => void callback(evt));
    const dispose = this.app._geode.plugins.addRibbonElement(
      `${this.manifest.id}:ribbon:${++this._uiCounter}`,
      el,
    );
    this.register(dispose);
    return el;
  }

  /** 'Adds a status bar item to the bottom of the app.' Returns the element. */
  addStatusBarItem(): HTMLElement {
    const el = document.createElement("div");
    el.className = "status-bar-item geode-compat-status";
    el.setAttribute("data-testid", `compat-status-${this.manifest.id}`);
    const dispose = this.app._geode.plugins.addStatusBarElement(
      `${this.manifest.id}:status:${++this._uiCounter}`,
      el,
    );
    this.register(dispose);
    return el;
  }

  /** 'Register a settings tab' — mounts into Geode's SettingsModal plugin area. */
  addSettingTab(settingTab: PluginSettingTab): void {
    const dispose = this.app._geode.plugins.addSettingsSection({
      id: `${this.manifest.id}:settings:${++this._uiCounter}`,
      pluginId: this.manifest.id,
      name: this.manifest.name,
      mount: (container: HTMLElement) => {
        settingTab.containerEl = container;
        try {
          settingTab.display();
        } catch (err) {
          console.error(`[obsidian-compat] ${this.manifest.id}: settings display() threw`, err);
        }
      },
      unmount: () => {
        try {
          settingTab.hide();
        } catch (err) {
          console.error(`[obsidian-compat] ${this.manifest.id}: settings hide() threw`, err);
        }
        settingTab.containerEl = document.createElement("div");
      },
    });
    this.register(dispose);
  }

  /* ----- data.json ----- */

  /** "plugins/<dir>/data.json" relative to .obsidian (adapter config IO). */
  private dataPath(): string {
    const dir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    const m = /\.obsidian\/(.+)$/.exec(dir);
    return `${m ? m[1] : `plugins/${this.manifest.id}`}/data.json`;
  }

  /** 'Load settings data from disk... stored in data.json in the plugin folder.' */
  async loadData(): Promise<unknown> {
    const raw = await this.app._geode.handle.vault.adapter.readConfig(this.dataPath());
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch (err) {
      console.error(`[obsidian-compat] ${this.manifest.id}: data.json is not valid JSON`, err);
      return null;
    }
  }

  /** 'Write settings data to disk.' */
  async saveData(data: unknown): Promise<void> {
    await this.app._geode.handle.vault.adapter.writeConfig(
      this.dataPath(),
      JSON.stringify(data ?? null, null, 2),
    );
  }

  /* ----- views (real since R5) ----- */

  /**
   * Register a custom view type; SidebarViewLeaf.setViewState mounts it.
   * Duplicate types warn + ignore. The unload disposer detaches every leaf
   * of the type, then unregisters the creator.
   */
  registerView(type: string, viewCreator: ViewCreator): void {
    const workspace = this.app.workspace;
    if (workspace._viewRegistry.has(type)) {
      console.warn(
        `[obsidian-compat] ${this.manifest.id}: view type "${type}" is already registered — ignored`,
      );
      return;
    }
    workspace._viewRegistry.set(type, { creator: viewCreator, pluginId: this.manifest.id });
    this.register(() => {
      workspace.detachLeavesOfType(type);
      workspace._viewRegistry.delete(type);
    });
  }

  /**
   * Register an EditorSuggest into the context's manager (real since R6).
   * Triggering order = registration order; the unload disposer unregisters
   * (and closes a popup the suggest still owns).
   */
  registerEditorSuggest(suggest: EditorSuggest<unknown>): void {
    const manager = this.app._suggests;
    if (!manager) {
      // context wiring failure only — never the normal path
      reportGap(this.manifest.id, "Plugin.registerEditorSuggest", "suggest manager not wired");
      return;
    }
    this.register(manager.register(suggest));
  }

  /* ----- out-of-tier APIs: warn-stubs, never a crash (T2/T3 gaps) ----- */

  registerExtensions(_extensions: string[], _viewType: string): void {
    reportGap(this.manifest.id, "Plugin.registerExtensions");
  }

  /**
   * R132: real — register a READING-VIEW markdown post-processor. Routes through the core
   * markdownPostProcessors registry (compat cannot import features/editor, so the registry is the
   * bridge: the reading view reads it + applies each processor to the freshly-rendered DOM). The
   * disposer is registered for plugin-unload cleanup. Live preview + code-block processors deferred.
   */
  registerMarkdownPostProcessor(
    postProcessor: MarkdownPostProcessor,
    sortOrder?: number,
  ): MarkdownPostProcessor {
    this.register(registerCoreMarkdownPostProcessor(postProcessor, sortOrder));
    return postProcessor;
  }

  /**
   * R133/R134: real — register a fenced-code-block handler for ```<language> blocks. Obsidian口径:
   * sugar over a post-processor that removes the rendered `<pre><code>` and hands the handler a fresh
   * `<div>` to fill. R134 routes through the core dual-registration point: it registers ONE handler
   * into both the reading-view post-processor list AND the lang→handler map the live-preview CM widget
   * reads — so `​```dataview`/`​```tasks` render in BOTH reading view and live preview. The disposer
   * tears down both. built-in mermaid/query fences render as `.geode-*` divs, never matching this lang.
   */
  registerMarkdownCodeBlockProcessor(
    language: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void | Promise<void>,
    sortOrder?: number,
  ): MarkdownPostProcessor {
    const { processor, dispose } = registerCoreCodeBlockProcessor(language, handler, sortOrder);
    this.register(dispose);
    return processor;
  }

  registerObsidianProtocolHandler(_action: string, _handler: unknown): void {
    reportGap(this.manifest.id, "Plugin.registerObsidianProtocolHandler");
  }

  /**
   * R115: real — add a CM6 extension to every markdown editor. Routes through the
   * core editorExtensions registry (compat cannot import features/editor, so the
   * registry is the bridge: EditorPane reconfigures each view's compat compartment
   * on the registry revision). The disposer is registered for plugin-unload cleanup.
   */
  registerEditorExtension(extension: Extension): void {
    this.register(registerCoreEditorExtension(extension));
  }

  /**
   * R25: real no-op registry. Geode's global hover preview already covers any
   * plugin-rendered `a.internal-link`, so no plugin participation is needed —
   * we just record the source id and return (no gap).
   *
   * GAP: plugin self-rendered previews (`hoverPopover` / `HoverParent`, where a
   * plugin mounts its own popover) remain unimplemented — out of R25 scope.
   */
  registerHoverLinkSource(id: string, _info: unknown): void {
    this._hoverLinkSources.add(id);
  }

  /** Called only on explicit user enable in real Obsidian — default no-op. */
  onUserEnable(): void {}
}

/* ---------------- static preview renderer ---------------- */

/**
 * R172: static MarkdownPreviewRenderer.registerPostProcessor / unregisterPostProcessor /
 * createCodeBlockPostProcessor — the static (non-Plugin) post-processor entry some older render
 * plugins use. Routes to the same core R132 registry as Plugin.registerMarkdownPostProcessor;
 * since there is no plugin-unload lifecycle here, disposers are tracked in a static Map keyed by
 * the processor so unregisterPostProcessor can tear down.
 */
export class MarkdownPreviewRenderer {
  private static disposers = new Map<MarkdownPostProcessor, () => void>();

  static registerPostProcessor(postProcessor: MarkdownPostProcessor, sortOrder?: number): void {
    // a re-register of the same processor disposes the prior registration first (no leak/dup)
    MarkdownPreviewRenderer.disposers.get(postProcessor)?.();
    MarkdownPreviewRenderer.disposers.set(
      postProcessor,
      registerCoreMarkdownPostProcessor(postProcessor, sortOrder),
    );
  }

  static unregisterPostProcessor(postProcessor: MarkdownPostProcessor): void {
    const dispose = MarkdownPreviewRenderer.disposers.get(postProcessor);
    if (!dispose) return; // not registered — no-op
    dispose();
    MarkdownPreviewRenderer.disposers.delete(postProcessor);
  }

  static createCodeBlockPostProcessor(
    language: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void | Promise<void>,
  ): MarkdownPostProcessor {
    return makeCodeBlockPostProcessor(language, handler);
  }
}

/* ---------------- setting tabs ---------------- */

export abstract class SettingTab {
  app!: App;
  /** Re-targeted by the host on mount; starts detached so early access is safe. */
  containerEl: HTMLElement = document.createElement("div");

  /** 'Override to render the tab' — called when the tab opens. */
  abstract display(): void;

  /** 'Hides the contents of the setting tab.' Default clears containerEl. */
  hide(): void {
    this.containerEl.empty();
  }
}

export abstract class PluginSettingTab extends SettingTab {
  plugin: Plugin;

  constructor(app: App, plugin: Plugin) {
    super();
    this.app = app;
    this.plugin = plugin;
  }
}
