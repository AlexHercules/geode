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

/** Where a plugin came from: compiled in, or loaded from `<vault>/.geode/plugins/*.js`. */
export type PluginSource = "builtin" | "external";

interface PluginRecord {
  plugin: GeodePlugin;
  enabled: boolean;
  readonly source: PluginSource;
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

  /** Register a plugin definition; enables it unless previously disabled. */
  async register(plugin: GeodePlugin, source: PluginSource = "builtin"): Promise<void> {
    if (this.records.has(plugin.id)) {
      console.warn(`[plugins] duplicate plugin id: ${plugin.id}`);
      return;
    }
    const record: PluginRecord = { plugin, enabled: false, source, disposers: [] };
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
    // yet (e.g. external ones, loaded after the builtins) are not erased
    const map = this.loadEnabledSet();
    for (const [id, r] of this.records) map[id] = r.enabled;
    try {
      localStorage.setItem(ENABLED_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }
}
