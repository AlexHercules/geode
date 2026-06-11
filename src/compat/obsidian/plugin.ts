/**
 * Obsidian Plugin base class + App shim + SettingTab/PluginSettingTab
 * (API-REFERENCE area 1).
 */
import { renameWithLinkUpdate } from "@core/linkRewrite";
import type { AppHandle, PluginManager } from "@core/plugins";
import type { Command as GeodeCommand } from "@core/types";
import { Component } from "./component";
import type { Editor } from "./editor";
import type { FileRegistry } from "./files";
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

/**
 * fileManager shim: `renameFile` is real since R16 (rename + link rewrite via
 * the core engine, matching the official "update all links" semantics — the
 * official Vault.rename stays a bare rename by design). Every OTHER method
 * access records a gap and resolves to undefined, so chains like
 * `app.fileManager.processFrontMatter(...)` do not crash. `then` is excluded
 * so the proxy is not accidentally thenable.
 */
function makeFileManager(handle: Omit<AppHandle, "ui">): unknown {
  // Official signature returns Promise<void>; the rewrite report is dropped.
  // `file` is duck-typed: any TAbstractFile-shaped object with a vault path.
  const renameFile = async (file: { path: string }, newPath: string): Promise<void> => {
    const { vault, metadata, documents } = handle;
    await renameWithLinkUpdate({ vault, metadata, documents }, file.path, normalizePath(newPath));
  };
  return new Proxy(
    {},
    {
      get(_target, prop): unknown {
        if (typeof prop !== "string" || prop === "then") return undefined;
        if (prop === "renameFile") return renameFile;
        reportGap("App", `fileManager.${prop}`, "no-op stub — resolves to undefined");
        return async () => undefined;
      },
    },
  );
}

const keymapStub = {
  pushScope(_scope: unknown): void {},
  popScope(_scope: unknown): void {},
};

const dragManagerStub = {
  dragFile: (): null => null,
  onDragStart: (): void => {},
};

const internalPluginsStub = {
  getEnabledPluginById: (): null => null,
  getPluginById: (): null => null,
  /** F6: calendar destructures app.internalPlugins.plugins["daily-notes"] */
  plugins: {} as Record<string, unknown>,
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

  constructor(bridge: GeodeBridge, vault: Vault, workspace: Workspace, metadataCache: MetadataCache) {
    this._geode = bridge;
    this.vault = vault;
    this.workspace = workspace;
    this.metadataCache = metadataCache;
  }

  /* ----- out-of-tier App members: warn-stubs, never a crash (T2 gaps) ----- */

  /** renameFile is real (R16); other methods gap per access in the proxy. */
  get fileManager(): unknown {
    return (this._fileManager ??= makeFileManager(this._geode.handle));
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
    reportGap("App", "App.internalPlugins", "warn-stub — lookups always return null");
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

  registerMarkdownPostProcessor<T>(postProcessor: T, _sortOrder?: number): T {
    reportGap(this.manifest.id, "Plugin.registerMarkdownPostProcessor");
    return postProcessor;
  }

  registerMarkdownCodeBlockProcessor(language: string, _handler: unknown, _sortOrder?: number): unknown {
    reportGap(this.manifest.id, "Plugin.registerMarkdownCodeBlockProcessor", `language "${language}"`);
    return null;
  }

  registerObsidianProtocolHandler(_action: string, _handler: unknown): void {
    reportGap(this.manifest.id, "Plugin.registerObsidianProtocolHandler");
  }

  registerEditorExtension(_extension: unknown): void {
    reportGap(this.manifest.id, "Plugin.registerEditorExtension");
  }

  registerHoverLinkSource(_id: string, _info: unknown): void {
    reportGap(this.manifest.id, "Plugin.registerHoverLinkSource");
  }

  /** Called only on explicit user enable in real Obsidian — default no-op. */
  onUserEnable(): void {}
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
