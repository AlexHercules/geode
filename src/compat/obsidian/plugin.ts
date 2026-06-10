/**
 * Obsidian Plugin base class + App shim + SettingTab/PluginSettingTab
 * (API-REFERENCE area 1).
 */
import type { AppHandle, PluginManager } from "@core/plugins";
import type { Command as GeodeCommand } from "@core/types";
import { Component } from "./component";
import type { Editor } from "./editor";
import type { FileRegistry } from "./files";
import { reportGap } from "./gaps";
import { getIconSvg, type IconName } from "./icons";
import type { MetadataCache } from "./metadata";
import { Scope } from "./ui";
import type { Vault } from "./vault";
import { makeActiveMarkdownView, type MarkdownView, type Workspace } from "./workspace";

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
 * fileManager warn-stub: every method access records a gap and resolves to
 * undefined, so chains like `app.fileManager.processFrontMatter(...)` do not
 * crash. `then` is excluded so the proxy is not accidentally thenable.
 */
const fileManagerStub: unknown = new Proxy(
  {},
  {
    get(_target, prop): unknown {
      if (typeof prop !== "string" || prop === "then") return undefined;
      reportGap("App", `fileManager.${prop}`, "no-op stub — resolves to undefined");
      return async () => undefined;
    },
  },
);

const keymapStub = {
  pushScope(_scope: unknown): void {},
  popScope(_scope: unknown): void {},
};

export class App {
  vault: Vault;
  workspace: Workspace;
  metadataCache: MetadataCache;
  /** @internal geode bridge — NOT part of the public obsidian surface */
  readonly _geode: GeodeBridge;
  private _scopeStub: Scope | null = null;

  constructor(bridge: GeodeBridge, vault: Vault, workspace: Workspace, metadataCache: MetadataCache) {
    this._geode = bridge;
    this.vault = vault;
    this.workspace = workspace;
    this.metadataCache = metadataCache;
  }

  /* ----- out-of-tier App members: warn-stubs, never a crash (T2 gaps) ----- */

  get fileManager(): unknown {
    reportGap("App", "App.fileManager", "warn-stub — methods are recorded no-ops");
    return fileManagerStub;
  }

  get keymap(): typeof keymapStub {
    reportGap("App", "App.keymap", "warn-stub — pushScope/popScope are no-ops");
    return keymapStub;
  }

  get scope(): Scope {
    reportGap("App", "App.scope", "warn-stub Scope — register is a no-op");
    return (this._scopeStub ??= new Scope());
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
    const getView = () => makeActiveMarkdownView(bridge.handle, bridge.registry);
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

  /* ----- out-of-tier APIs: warn-stubs, never a crash (T2/T3 gaps) ----- */

  registerView(type: string, _viewCreator: unknown): void {
    reportGap(this.manifest.id, "Plugin.registerView", `view type "${type}" will not render`);
  }

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

  registerEditorSuggest(_suggest: unknown): void {
    reportGap(this.manifest.id, "Plugin.registerEditorSuggest");
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
