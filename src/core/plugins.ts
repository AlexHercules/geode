import type { Command } from "./types";
import { EventBus, EventMap, EventName } from "./events";
import { CommandRegistry } from "./commands";
import { DocumentManager } from "./documents";
import { MetadataIndex } from "./metadata";
import { Store } from "./store";
import { Vault } from "./vault";
import { Workspace } from "./workspace";

/**
 * Geode plugin API — the extensibility surface, modelled on Obsidian's.
 * A plugin receives an AppHandle in onload() and may:
 *   - register commands (appear in palette + hotkeys)
 *   - subscribe to vault/workspace events
 *   - read & modify notes through the vault
 *   - contribute status-bar items
 * Built-in plugins are compiled in; the same interface is exposed on
 * `window.geode` so external scripts can register plugins at runtime.
 */
export interface AppHandle {
  vault: Vault;
  metadata: MetadataIndex;
  workspace: Workspace;
  commands: CommandRegistry;
  events: EventBus;
  /** shared document model (R4) — open files, dirty state, the active editor view */
  documents: DocumentManager;
  ui: {
    /** set (or update) a status bar item; returns a disposer */
    setStatusBarItem(id: string, text: string): void;
    removeStatusBarItem(id: string): void;
  };
}

export interface GeodePlugin {
  id: string;
  name: string;
  description?: string;
  version?: string;
  onload(app: AppHandle): void | Promise<void>;
  onunload?(): void;
  /** called only when the user explicitly enables the plugin (settings toggle), after onload */
  onUserEnable?(): void;
}

/**
 * Where a plugin came from: compiled in, loaded from `<vault>/.geode/plugins/*.js`,
 * or an Obsidian community plugin from `<vault>/.obsidian/plugins/` (compat layer).
 */
export type PluginSource = "builtin" | "external" | "obsidian";

/** Per-record registration options (R4). */
export interface RegisterOptions {
  /** Initial enabled state, overriding the localStorage enabled-set. */
  enabled?: boolean;
  /**
   * External persistence for the enabled flag (e.g. community-plugins.json).
   * When given, localStorage persistence is skipped for this record.
   */
  persistEnabled?: (enabled: boolean) => void;
}

/** A sidebar panel contributed by a plugin (compat registerView); App shell hosts it. */
export interface SidebarPanelContribution {
  /** unique, e.g. "obsidian:view:recent-files" */
  id: string;
  side: "left" | "right";
  title: string;
  /**
   * Raw <svg> markup for the selector button. MUST come from a trusted source:
   * it is rendered via dangerouslySetInnerHTML (the shell only validates that
   * the markup is a single <svg> root element).
   */
  iconSvg?: string;
  /** panel body, owned by the contributor */
  el: HTMLElement;
}

/** A plugin settings UI section (compat PluginSettingTab); SettingsModal hosts it. */
export interface PluginSettingsSection {
  id: string;
  pluginId: string;
  name: string;
  mount(container: HTMLElement): void;
  unmount(): void;
}

interface PluginRecord {
  plugin: GeodePlugin;
  enabled: boolean;
  readonly source: PluginSource;
  options?: RegisterOptions;
  /** disposers collected while the plugin was active */
  disposers: Array<() => void>;
}

/** Structural validation for plugin objects coming from user scripts. */
function isGeodePlugin(value: unknown): value is GeodePlugin {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    v["id"].length > 0 &&
    typeof v["name"] === "string" &&
    v["name"].length > 0 &&
    typeof v["onload"] === "function"
  );
}

const ENABLED_KEY = "geode.plugins.enabled.v1";

export class PluginManager {
  /** plugin list + enabled flags; bump-driven */
  readonly revision = new Store(0);
  /** status bar items contributed by plugins (id -> text) */
  readonly statusBarItems = new Store<ReadonlyMap<string, string>>(new Map());
  /** element-based status bar items (compat addStatusBarItem); shell hosts the els */
  readonly statusBarElements = new Store<ReadonlyArray<{ id: string; el: HTMLElement }>>([]);
  /** ribbon icons (compat addRibbonIcon); each el carries its own click handler */
  readonly ribbonItems = new Store<ReadonlyArray<{ id: string; el: HTMLElement }>>([]);
  /** plugin settings sections (compat PluginSettingTab) rendered by SettingsModal */
  readonly settingsSections = new Store<ReadonlyArray<PluginSettingsSection>>([]);
  /** sidebar panels (compat registerView custom views) hosted by the App shell */
  readonly sidebarPanels = new Store<ReadonlyArray<SidebarPanelContribution>>([]);

  private records = new Map<string, PluginRecord>();
  /** ids of plugins loaded from <vault>/.geode/plugins — unloaded on every reload */
  private externalIds = new Set<string>();

  constructor(private app: Omit<AppHandle, "ui">) {}

  /** AppHandle handed to plugins, with disposer tracking per plugin. */
  private makeHandle(record: PluginRecord): AppHandle {
    const { commands, events } = this.app;
    const track = <T extends () => void>(d: T): T => {
      record.disposers.push(d);
      return d;
    };
    return {
      ...this.app,
      commands: new Proxy(commands, {
        get: (target, prop) => {
          if (prop === "register") {
            return (cmd: Command) => track(target.register(cmd));
          }
          return Reflect.get(target, prop);
        },
      }) as CommandRegistry,
      events: new Proxy(events, {
        get: (target, prop) => {
          if (prop === "on") {
            return <E extends EventName>(event: E, handler: (p: EventMap[E]) => void) =>
              track(target.on(event, handler));
          }
          return Reflect.get(target, prop);
        },
      }) as EventBus,
      ui: {
        setStatusBarItem: (id, text) => {
          const scoped = `${record.plugin.id}:${id}`;
          this.statusBarItems.update((m) => new Map(m).set(scoped, text));
          record.disposers.push(() => this.removeItem(scoped));
        },
        removeStatusBarItem: (id) => this.removeItem(`${record.plugin.id}:${id}`),
      },
    };
  }

  private removeItem(scopedId: string) {
    this.statusBarItems.update((m) => {
      if (!m.has(scopedId)) return m;
      const next = new Map(m);
      next.delete(scopedId);
      return next;
    });
  }

  /**
   * Register a plugin definition; enables it unless previously disabled
   * (or unless `opts.enabled` explicitly says otherwise).
   */
  async register(
    plugin: GeodePlugin,
    source: PluginSource = "builtin",
    opts?: RegisterOptions,
  ): Promise<void> {
    if (this.records.has(plugin.id)) {
      console.warn(`[plugins] duplicate plugin id: ${plugin.id}`);
      return;
    }
    const record: PluginRecord = { plugin, enabled: false, source, options: opts, disposers: [] };
    this.records.set(plugin.id, record);
    const initiallyEnabled = opts?.enabled ?? this.loadEnabledSet()[plugin.id] !== false;
    if (initiallyEnabled) {
      await this.enable(plugin.id);
    } else {
      this.revision.update((n) => n + 1);
    }
  }

  async enable(id: string, opts?: { userAction?: boolean }): Promise<void> {
    const record = this.records.get(id);
    if (!record || record.enabled) return;
    try {
      await record.plugin.onload(this.makeHandle(record));
      record.enabled = true;
      this.persistRecord(record);
      this.revision.update((n) => n + 1);
      if (opts?.userAction) {
        try {
          record.plugin.onUserEnable?.();
        } catch (err) {
          console.error(`[plugins] ${id} onUserEnable threw`, err);
        }
      }
    } catch (err) {
      console.error(`[plugins] ${id} failed to load`, err);
      record.disposers.forEach((d) => d());
      record.disposers = [];
    }
  }

  disable(id: string): void {
    const record = this.records.get(id);
    if (!record || !record.enabled) return;
    try {
      record.plugin.onunload?.();
    } catch (err) {
      console.error(`[plugins] ${id} onunload threw`, err);
    }
    record.disposers.forEach((d) => d());
    record.disposers = [];
    record.enabled = false;
    this.persistRecord(record);
    this.revision.update((n) => n + 1);
  }

  /** Persist one record's enabled flag — external hook wins over localStorage. */
  private persistRecord(record: PluginRecord) {
    if (record.options?.persistEnabled) {
      try {
        record.options.persistEnabled(record.enabled);
      } catch (err) {
        console.error(`[plugins] persistEnabled hook for ${record.plugin.id} threw`, err);
      }
      return;
    }
    this.persistEnabled();
  }

  /**
   * Tear a plugin down and drop its record entirely WITHOUT persisting
   * enabled:false (used by compat/external reloads — the user's last toggle
   * must survive a reload).
   */
  unregister(id: string): void {
    this.removeRecord(id);
  }

  /**
   * Tear a plugin down and drop its record entirely (used when reloading
   * external plugins). Unlike disable(), this does NOT persist `enabled:false`
   * for the id — the user's last toggle must survive a reload.
   */
  private removeRecord(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    if (record.enabled) {
      try {
        record.plugin.onunload?.();
      } catch (err) {
        console.error(`[plugins] ${id} onunload threw`, err);
      }
      record.disposers.forEach((d) => d());
      record.disposers = [];
      record.enabled = false;
    }
    this.records.delete(id);
    this.revision.update((n) => n + 1);
  }

  /**
   * Load external plugins from `<vault>/.geode/plugins/*.js`.
   *
   * Idempotent: previously loaded external plugins are unloaded (and their
   * records removed) first, so calling this again performs a clean reload.
   *
   * Each script is evaluated with `new Function("geode", "module", "exports")`
   * and may register a plugin either by calling `geode.registerPlugin(obj)` or
   * by assigning `module.exports = obj` (or `exports.default = obj`). Scripts
   * are user-owned local code — same trust model as Obsidian plugins, no
   * sandbox. One bad script never breaks the rest.
   */
  async loadExternal(vault: Vault): Promise<void> {
    // unload everything from the previous round first
    for (const id of [...this.externalIds]) this.removeRecord(id);
    this.externalIds.clear();

    let files: Array<{ name: string; content: string }>;
    try {
      files = await vault.adapter.listPluginFiles();
    } catch (err) {
      console.error("[plugins] failed to list external plugin files", err);
      return;
    }

    for (const file of files) {
      try {
        const collected: unknown[] = [];
        const geode = {
          registerPlugin: (p: unknown) => {
            collected.push(p);
          },
        };
        const moduleObj: { exports: unknown } = { exports: {} };
        // Plugins are local user-owned code (see docs/PLUGINS.md) — evaluated
        // unsandboxed, like Obsidian does.
        const run = new Function("geode", "module", "exports", file.content);
        run(geode, moduleObj, moduleObj.exports);

        // module.exports convention (direct assignment or exports.default)
        if (collected.length === 0) {
          const ex = moduleObj.exports;
          if (isGeodePlugin(ex)) {
            collected.push(ex);
          } else if (typeof ex === "object" && ex !== null && "default" in ex) {
            collected.push((ex as { default: unknown }).default);
          }
        }

        if (collected.length === 0) {
          console.error(
            `[plugins] ${file.name}: no plugin registered — call geode.registerPlugin(...) or set module.exports`,
          );
          continue;
        }

        for (const candidate of collected) {
          if (!isGeodePlugin(candidate)) {
            console.error(
              `[plugins] ${file.name}: invalid plugin shape (need string id, string name, onload function)`,
            );
            continue;
          }
          if (this.records.has(candidate.id)) {
            console.error(
              `[plugins] ${file.name}: id "${candidate.id}" collides with an existing plugin — skipped`,
            );
            continue;
          }
          await this.register(candidate, "external");
          this.externalIds.add(candidate.id);
        }
      } catch (err) {
        console.error(`[plugins] failed to evaluate ${file.name}`, err);
      }
    }
  }

  /* ---------- element-based UI contributions (compat layer; shell hosts them) ---------- */

  addStatusBarElement(id: string, el: HTMLElement): () => void {
    this.statusBarElements.update((arr) => [...arr.filter((x) => x.id !== id), { id, el }]);
    return () => this.statusBarElements.update((arr) => arr.filter((x) => x.id !== id));
  }

  addRibbonElement(id: string, el: HTMLElement): () => void {
    this.ribbonItems.update((arr) => [...arr.filter((x) => x.id !== id), { id, el }]);
    return () => this.ribbonItems.update((arr) => arr.filter((x) => x.id !== id));
  }

  addSidebarPanel(panel: SidebarPanelContribution): () => void {
    this.sidebarPanels.update((arr) => [...arr.filter((x) => x.id !== panel.id), panel]);
    // dispose by object identity, so a later same-id registration is not torn
    // down by a stale disposer
    return () => this.sidebarPanels.update((arr) => arr.filter((x) => x !== panel));
  }

  addSettingsSection(section: PluginSettingsSection): () => void {
    this.settingsSections.update((arr) => [
      ...arr.filter((x) => x.id !== section.id),
      section,
    ]);
    return () => this.settingsSections.update((arr) => arr.filter((x) => x.id !== section.id));
  }

  list(): Array<{ plugin: GeodePlugin; enabled: boolean; source: PluginSource }> {
    return [...this.records.values()].map((r) => ({
      plugin: r.plugin,
      enabled: r.enabled,
      source: r.source,
    }));
  }

  isEnabled(id: string): boolean {
    return this.records.get(id)?.enabled ?? false;
  }

  private loadEnabledSet(): Record<string, boolean> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(ENABLED_KEY) ?? "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return parsed as Record<string, boolean>;
    } catch {
      return {};
    }
  }

  private persistEnabled() {
    // merge over the stored map so flags for plugins that are not registered
    // yet (e.g. external ones, loaded after the builtins) are not erased;
    // records with an external persistence hook never enter localStorage
    const map = this.loadEnabledSet();
    for (const [id, r] of this.records) {
      if (!r.options?.persistEnabled) map[id] = r.enabled;
    }
    try {
      localStorage.setItem(ENABLED_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }
}
