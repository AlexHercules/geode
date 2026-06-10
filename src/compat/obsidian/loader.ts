/**
 * Obsidian plugin compatibility loader (T0) — discovers and runs plugins from
 * `<vault>/.obsidian/plugins/`. Idempotent like PluginManager.loadExternal:
 * previously loaded obsidian records are unloaded first.
 *
 * Pipeline (ARCHITECTURE.md "Round 4 additions" + API-REFERENCE area 6):
 *   discover -> validate manifest -> evaluate main.js as CommonJS with the
 *   host require map -> resolve ctor (exports.default ?? module.exports) ->
 *   wrap as a GeodePlugin record -> register(wrapper, "obsidian", { enabled,
 *   persistEnabled }) mirroring community-plugins.json. styles.css is injected
 *   per plugin on enable and removed on disable. Per-plugin failures isolate.
 */
import * as cmAutocomplete from "@codemirror/autocomplete";
import * as cmCommands from "@codemirror/commands";
import * as cmLanguage from "@codemirror/language";
import * as cmSearch from "@codemirror/search";
import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";
import * as lezerHighlight from "@lezer/highlight";
import type { AppHandle, GeodePlugin, PluginManager } from "@core/plugins";
import type { ObsidianPluginSource, Vault } from "@core/vault";
import { loadComponentAsync } from "./component";
import { createCompatContext, type CompatContext } from "./context";
import { installDomAugmentation } from "./dom";
import { FIXTURE_PLUGIN, FIXTURE_PLUGIN_ID } from "./fixture";
import { drainGaps } from "./gaps";
import * as obsidianModule from "./index";
import type { Plugin as ObsidianPlugin, PluginManifest } from "./plugin";
import { apiVersion, semverCompare } from "./util";

/* ---------------- host require map ---------------- */

/**
 * `obsidian` resolves to the shim; @codemirror/* and @lezer/highlight resolve
 * to the HOST instances (instanceof across plugin/host must work). Anything
 * else throws — the loader records it as the plugin's failure reason.
 */
const HOST_MODULES: Record<string, unknown> = {
  obsidian: obsidianModule,
  "@codemirror/state": cmState,
  "@codemirror/view": cmView,
  "@codemirror/language": cmLanguage,
  "@codemirror/commands": cmCommands,
  "@codemirror/search": cmSearch,
  "@codemirror/autocomplete": cmAutocomplete,
  "@lezer/highlight": lezerHighlight,
};

function hostRequire(id: string): unknown {
  const mod = HOST_MODULES[id];
  if (mod === undefined) throw new Error(`module not available in Geode: ${id}`);
  return mod;
}

/* ---------------- community-plugins.json (enabled state) ---------------- */

const COMMUNITY_PLUGINS = "community-plugins.json";

async function readEnabledIds(vault: Vault): Promise<string[]> {
  try {
    const raw = await vault.adapter.readConfig(COMMUNITY_PLUGINS);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch (err) {
    console.warn(`[obsidian-compat] failed to read ${COMMUNITY_PLUGINS}`, err);
    return [];
  }
}

/** Serialized read-modify-write preserving unknown ids and their order. */
let persistChain: Promise<void> = Promise.resolve();

function persistEnabledId(vault: Vault, id: string, enabled: boolean): void {
  persistChain = persistChain
    .then(async () => {
      let list: unknown[] = [];
      try {
        const raw = await vault.adapter.readConfig(COMMUNITY_PLUGINS);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
        }
      } catch {
        /* corrupted file — rewrite from scratch */
      }
      const next = enabled
        ? list.includes(id)
          ? list
          : [...list, id]
        : list.filter((x) => x !== id);
      await vault.adapter.writeConfig(COMMUNITY_PLUGINS, JSON.stringify(next, null, 2));
    })
    .catch((err) => {
      console.error(`[obsidian-compat] failed to persist enabled state for "${id}"`, err);
    });
}

/* ---------------- manifest validation ---------------- */

interface RawManifest extends Partial<PluginManifest> {
  id?: string;
  name?: string;
  version?: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/* ---------------- per-round state (idempotent reloads) ---------------- */

let previousContext: CompatContext | null = null;
let loadedIds: string[] = [];

interface PluginReport {
  id: string;
  status: "enabled" | "disabled" | "failed" | "skipped";
  detail?: string;
}

/* ---------------- the frozen entry point ---------------- */

export async function loadObsidianPlugins(
  app: Omit<AppHandle, "ui">,
  vault: Vault,
): Promise<void> {
  // PluginManager travels on the bootstrap GeodeApp object (same shape minus "ui")
  const plugins = (app as Partial<{ plugins: PluginManager }>).plugins;
  if (!plugins) {
    console.error("[obsidian-compat] loader requires app.plugins (PluginManager) on the handle");
    return;
  }

  installDomAugmentation();

  // idempotent: unload the previous round first (does NOT persist enabled:false)
  for (const id of loadedIds.splice(0)) plugins.unregister(id);
  previousContext?.dispose();
  const ctx = (previousContext = createCompatContext(app, plugins, vault));

  let sources: ObsidianPluginSource[] = [];
  try {
    sources = await vault.adapter.listObsidianPlugins();
  } catch (err) {
    console.error("[obsidian-compat] failed to list obsidian plugins", err);
  }

  // browser E2E surface: ?obsfixture=1 injects the built-in fixture plugin
  const fixtureRequested =
    typeof location !== "undefined" && /[?&]obsfixture=1/.test(location.search);
  if (fixtureRequested && !sources.some((s) => s.dir === FIXTURE_PLUGIN.dir)) {
    sources = [...sources, FIXTURE_PLUGIN];
  }

  const enabledIds = await readEnabledIds(vault);
  const seenIds = new Set<string>();
  const report: PluginReport[] = [];

  for (const source of sources) {
    const entry = await loadOne(source);
    report.push(entry);
  }

  logReport(report);

  /* ---------------- per-plugin pipeline (failures isolate) ---------------- */

  async function loadOne(source: ObsidianPluginSource): Promise<PluginReport> {
    /* 1. manifest */
    let raw: RawManifest;
    try {
      raw = JSON.parse(source.manifestJson) as RawManifest;
    } catch (err) {
      console.error(`[obsidian-compat] ${source.dir}: manifest.json is not valid JSON`, err);
      return { id: source.dir, status: "skipped", detail: "invalid manifest JSON" };
    }
    if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name) || !isNonEmptyString(raw.version)) {
      console.error(
        `[obsidian-compat] ${source.dir}: manifest must have non-empty id, name and version — skipped`,
      );
      return { id: source.dir, status: "skipped", detail: "missing id/name/version" };
    }
    const id = raw.id;
    if (seenIds.has(id)) {
      console.error(`[obsidian-compat] ${source.dir}: duplicate plugin id "${id}" — skipped`);
      return { id, status: "skipped", detail: "duplicate id" };
    }
    seenIds.add(id);
    if (source.dir !== id) {
      console.warn(`[obsidian-compat] folder "${source.dir}" does not match manifest id "${id}"`);
    }
    if (isNonEmptyString(raw.minAppVersion) && semverCompare(raw.minAppVersion, apiVersion) > 0) {
      console.warn(
        `[obsidian-compat] ${id}: requires app ${raw.minAppVersion} but Geode reports ${apiVersion} — loading anyway`,
      );
    }
    if (plugins!.list().some((r) => r.plugin.id === id)) {
      console.error(`[obsidian-compat] ${id}: collides with an existing Geode plugin — skipped`);
      return { id, status: "skipped", detail: "id collision with a host plugin" };
    }

    const manifest: PluginManifest = {
      author: "",
      minAppVersion: "",
      description: "",
      ...raw,
      id,
      name: raw.name,
      version: raw.version,
      dir: `.obsidian/plugins/${source.dir}`,
    };

    /* 2. evaluate main.js as CommonJS and resolve the constructor */
    let ctor: new (app: obsidianModule.App, manifest: PluginManifest) => ObsidianPlugin;
    try {
      const moduleObj: { exports: unknown } = { exports: {} };
      const run = new Function(
        "require",
        "module",
        "exports",
        `${source.mainJs}\n//# sourceURL=obsidian:${id}`,
      ) as (require: (id: string) => unknown, module: { exports: unknown }, exports: unknown) => void;
      run(hostRequire, moduleObj, moduleObj.exports);
      const exported = moduleObj.exports as { default?: unknown } | null;
      const candidate =
        typeof exported?.default === "function" ? exported.default : moduleObj.exports;
      if (typeof candidate !== "function") {
        throw new Error("main.js did not export a plugin constructor (exports.default / module.exports)");
      }
      ctor = candidate as typeof ctor;
    } catch (err) {
      console.error(`[obsidian-compat] ${id}: failed to evaluate main.js`, err);
      return { id, status: "failed", detail: err instanceof Error ? err.message : String(err) };
    }

    /* 3. wrap as a GeodePlugin (instance created lazily on each enable) */
    let instance: ObsidianPlugin | null = null;
    let styleEl: HTMLStyleElement | null = null;
    const removeStyles = (): void => {
      styleEl?.remove();
      styleEl = null;
    };
    const wrapper: GeodePlugin = {
      id,
      name: manifest.name,
      description: manifest.description || undefined,
      version: manifest.version,
      onload: async () => {
        if (source.stylesCss) {
          styleEl = document.createElement("style");
          styleEl.setAttribute("data-obsidian-plugin", id);
          styleEl.textContent = source.stylesCss;
          document.head.appendChild(styleEl);
        }
        try {
          instance = new ctor(ctx.app, { ...manifest });
          if (typeof (instance as { load?: unknown }).load !== "function") {
            throw new Error("exported class does not extend obsidian.Plugin");
          }
          await loadComponentAsync(instance);
        } catch (err) {
          instance = null;
          removeStyles();
          throw err;
        }
      },
      onunload: () => {
        try {
          instance?.unload();
        } finally {
          instance = null;
          removeStyles();
        }
      },
    };

    /* 4. register; enabled mirrors community-plugins.json (fixture opts in) */
    const enabled = enabledIds.includes(id) || (fixtureRequested && id === FIXTURE_PLUGIN_ID);
    try {
      await plugins!.register(wrapper, "obsidian", {
        enabled,
        persistEnabled: (on) => persistEnabledId(vault, id, on),
      });
      loadedIds.push(id);
    } catch (err) {
      console.error(`[obsidian-compat] ${id}: registration failed`, err);
      return { id, status: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
    if (enabled && !plugins!.isEnabled(id)) {
      // PluginManager caught the onload failure — surface it in the report
      return { id, status: "failed", detail: "onload failed (see error above)" };
    }
    return { id, status: enabled ? "enabled" : "disabled" };
  }
}

/* ---------------- status report ---------------- */

function logReport(report: PluginReport[]): void {
  const gaps = drainGaps();
  const enabled = report.filter((r) => r.status === "enabled").length;
  const failed = report.filter((r) => r.status === "failed" || r.status === "skipped").length;
  console.groupCollapsed(
    `[obsidian-compat] ${report.length} plugin(s): ${enabled} enabled, ` +
      `${report.length - enabled - failed} disabled, ${failed} failed/skipped — ${gaps.length} API gap(s)`,
  );
  for (const r of report) {
    console.log(`${r.status.padEnd(8)} ${r.id}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  if (gaps.length > 0) {
    console.log("API gaps hit during this load:");
    for (const g of gaps) {
      console.log(`  ${g.scope}: ${g.api}${g.detail ? ` (${g.detail})` : ""}`);
    }
  }
  console.groupEnd();
}
