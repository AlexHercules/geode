import type { Command } from "./types";
import { EventBus, EventMap, EventName } from "./events";
import { CommandRegistry } from "./commands";
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
}

interface PluginRecord {
  plugin: GeodePlugin;
  enabled: boolean;
  /** disposers collected while the plugin was active */
  disposers: Array<() => void>;
}

const ENABLED_KEY = "geode.plugins.enabled.v1";

export class PluginManager {
  /** plugin list + enabled flags; bump-driven */
  readonly revision = new Store(0);
  /** status bar items contributed by plugins (id -> text) */
  readonly statusBarItems = new Store<ReadonlyMap<string, string>>(new Map());

  private records = new Map<string, PluginRecord>();

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

  /** Register a plugin definition; enables it unless previously disabled. */
  async register(plugin: GeodePlugin): Promise<void> {
    if (this.records.has(plugin.id)) {
      console.warn(`[plugins] duplicate plugin id: ${plugin.id}`);
      return;
    }
    const record: PluginRecord = { plugin, enabled: false, disposers: [] };
    this.records.set(plugin.id, record);
    if (this.loadEnabledSet()[plugin.id] !== false) {
      await this.enable(plugin.id);
    } else {
      this.revision.update((n) => n + 1);
    }
  }

  async enable(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record || record.enabled) return;
    try {
      await record.plugin.onload(this.makeHandle(record));
      record.enabled = true;
      this.persistEnabled();
      this.revision.update((n) => n + 1);
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
    this.persistEnabled();
    this.revision.update((n) => n + 1);
  }

  /**
   * STUB (R2): load external plugins from `<vault>/.geode/plugins/*.js` via
   * vault.adapter.listPluginFiles(). Idempotent — re-loading first unloads
   * previously loaded external plugins. Implemented by the plugin-loader agent.
   */
  async loadExternal(_vault: Vault): Promise<void> {}

  list(): Array<{ plugin: GeodePlugin; enabled: boolean }> {
    return [...this.records.values()].map((r) => ({ plugin: r.plugin, enabled: r.enabled }));
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
    const map: Record<string, boolean> = {};
    for (const [id, r] of this.records) map[id] = r.enabled;
    try {
      localStorage.setItem(ENABLED_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }
}
