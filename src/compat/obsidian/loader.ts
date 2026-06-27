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
import { Store } from "@core/store";
import type { ObsidianPluginSource, Vault } from "@core/vault";
import { loadComponentAsync } from "./component";
import { createCompatContext, type CompatContext } from "./context";
import { installDomAugmentation } from "./dom";
import { FIXTURE_PLUGIN, FIXTURE_PLUGIN_ID } from "./fixture";
import { es5Callable } from "./es5compat";
import { drainGaps, resetGaps } from "./gaps";
import * as obsidianModule from "./index";
import { pathShim } from "./path-shim";
import type { Plugin as ObsidianPlugin, PluginManifest } from "./plugin";
import { apiVersion, moment, semverCompare } from "./util";

/* ---------------- host require map ---------------- */

/**
 * `obsidian` resolves to the shim; @codemirror/* and @lezer/highlight resolve
 * to the HOST instances (instanceof across plugin/host must work); `path` is
 * a tiny posix string shim (plugins require it at evaluate time). Anything
 * else throws — the loader records it as the plugin's failure reason.
 */
// R258: plugins compiled to ES5 with tslib inherit via `Base.apply(this)`, which the
// shim's ES6 base classes reject. Hand plugins ES5-callable wrappers of the extendable
// bases (the shim's own internals + index.ts keep the raw ES6 classes). ES6-target
// plugins (super()/new) are unaffected — the Proxy forwards [[Construct]] transparently.
//
// ONLY throwaway-safe bases are wrapped (see es5compat.ts): field-init (Plugin/Component/
// MarkdownRenderChild/PluginSettingTab) and detached-DOM-in-fields (View/ItemView/FileView).
// The suggest/modal families (Modal/SuggestModal/FuzzySuggestModal/EditorSuggest/
// AbstractInputSuggest) bind `this`-capturing listeners in their constructors, which the
// throwaway-harvest cannot copy correctly — they are deliberately left UNwrapped, so an
// ES5/tslib plugin extending them hard-fails to load with a clear, getLastError-surfaced
// error instead of silently loading a broken instance. (Future round: defer their ctor
// listener-registration so they become throwaway-safe too.)
const obsidianForPlugins = {
  ...obsidianModule,
  Component: es5Callable(obsidianModule.Component),
  MarkdownRenderChild: es5Callable(obsidianModule.MarkdownRenderChild),
  Plugin: es5Callable(obsidianModule.Plugin),
  PluginSettingTab: es5Callable(obsidianModule.PluginSettingTab),
  View: es5Callable(obsidianModule.View),
  ItemView: es5Callable(obsidianModule.ItemView),
  FileView: es5Callable(obsidianModule.FileView),
};

const HOST_MODULES: Record<string, unknown> = {
  obsidian: obsidianForPlugins,
  path: pathShim,
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

export interface ObsidianPluginReport {
  id: string;
  status: "enabled" | "disabled" | "failed" | "skipped";
  detail?: string;
  /** set when manifest.minAppVersion exceeds the shim's apiVersion */
  minAppWarning?: string;
}

/**
 * Last load report — SettingsModal renders failed/skipped entries (with their
 * failure reason) and minAppVersion warnings from here.
 */
export const obsidianLoadReport = new Store<ReadonlyArray<ObsidianPluginReport>>([]);

/* ---------------- the frozen entry point ---------------- */

/**
 * Serialized via a module-level promise chain: a second call always waits for
 * the in-flight run to finish its full unregister/dispose/register cycle, so
 * concurrent reloads can never register plugins against a disposed context.
 */
let loadChain: Promise<void> = Promise.resolve();

export function loadObsidianPlugins(
  app: Omit<AppHandle, "ui"> & { plugins: PluginManager },
  vault: Vault,
): Promise<void> {
  const run = loadChain.then(() => runLoad(app, vault));
  loadChain = run.catch(() => undefined);
  return run;
}

async function runLoad(
  app: Omit<AppHandle, "ui"> & { plugins: PluginManager },
  vault: Vault,
): Promise<void> {
  const plugins = app.plugins;

  installDomAugmentation();

  // suite plugins (nldates, calendar) consume moment exclusively via the
  // global — expose it BEFORE any main.js evaluates (desktop and browser/
  // fixture paths both come through here). Never overwrite an existing one.
  window.moment ??= moment;

  // R261: legacy CodeMirror 5 stub. Obsidian historically exposes the CM5 instance as
  // window.CodeMirror; Dataview's registerDataviewjsCodeHighlighting calls
  // CodeMirror.defineMode/getMode to register a CM5 syntax mode for ```dataviewjs blocks.
  // Geode is CM6-only (no legacy editor), so that mode is never used — a no-op stub lets
  // such plugins load (the dataviewjs block still renders via the CM6/markdown path).
  (window as { CodeMirror?: unknown }).CodeMirror ??= {
    defineMode: () => undefined,
    getMode: () => ({}),
  };

  // B3③ (R165): Node-targeting plugin bundles (obsidian-git etc.) reference the
  // Node global `global` as a free variable and crash with "Can't find variable:
  // global" when main.js evaluates. Point it at globalThis so the lookup resolves
  // — idempotent (??=), never clobbers a real one. (Unrelated to window.moment
  // above, which is the *moment* global.) process/Buffer are intentionally NOT
  // shimmed: `typeof process` branches in bundles would silently change behavior.
  (globalThis as { global?: unknown }).global ??= globalThis;

  // idempotent: unload the previous round first (does NOT persist enabled:false)
  for (const id of loadedIds.splice(0)) plugins.unregister(id);
  previousContext?.dispose();
  resetGaps(); // warn-once + report state is per load
  const ctx = (previousContext = createCompatContext(app, plugins, vault));

  // F5: real Obsidian exposes the App instance as window.app — plugins read it
  // outside their onload args. Plain assignment (NOT ??=): every reload must
  // point at the NEW context's App shim, before any plugin main.js evaluates.
  window.app = ctx.app;

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
  const report: ObsidianPluginReport[] = [];

  for (const source of sources) {
    const entry = await loadOne(source);
    report.push(entry);
  }

  // CREATE-ON-LOAD replay (API-REFERENCE area 2): real Obsidian fires vault
  // 'create' for every existing file when the vault loads. Replay it now that
  // plugins have registered their handlers; onLayoutReady callbacks queued
  // during the plugin loop flush AFTER the replay (the documented opt-out).
  for (const f of ctx.registry.allLoadedFiles()) {
    if (f !== ctx.registry.root) ctx.vault.trigger("create", f);
  }
  ctx.workspace._flushLayoutReady();

  // initial 'resolved' (fires once after vault-wide resolution): if the core
  // index finished before plugin load, deliver it now; otherwise the pending
  // metadata:updated will trigger it through the context handler.
  if (app.metadata.revision.get() > 0) ctx.metadataCache.trigger("resolved");

  obsidianLoadReport.set(report);
  logReport(report);

  /* ---------------- per-plugin pipeline (failures isolate) ---------------- */

  async function loadOne(source: ObsidianPluginSource): Promise<ObsidianPluginReport> {
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
    // contract: missing id/name/version rejects; OTHER gaps warn (never block —
    // absent minAppVersion in particular must not reject)
    const missing = (["author", "minAppVersion", "description"] as const).filter(
      (k) => !isNonEmptyString(raw[k]),
    );
    if (missing.length > 0) {
      console.warn(
        `[obsidian-compat] ${id}: manifest missing ${missing.join(", ")} — defaulting to ""`,
      );
    }
    let minAppWarning: string | undefined;
    if (isNonEmptyString(raw.minAppVersion) && semverCompare(raw.minAppVersion, apiVersion) > 0) {
      minAppWarning = `requires app ${raw.minAppVersion} (Geode reports ${apiVersion})`;
      console.warn(`[obsidian-compat] ${id}: ${minAppWarning} — loading anyway`);
    }
    if (plugins.list().some((r) => r.plugin.id === id)) {
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
      return {
        id,
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
        ...(minAppWarning ? { minAppWarning } : {}),
      };
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
          // unload the partially-loaded Component: commands, DOM listeners,
          // intervals and event refs registered before the throw must not leak
          try {
            if (instance && typeof (instance as { unload?: unknown }).unload === "function") {
              instance.unload();
            }
          } catch (cleanupErr) {
            console.error(
              `[obsidian-compat] ${id}: cleanup after failed onload threw`,
              cleanupErr,
            );
          }
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
      // F3: forward the host's explicit-user-enable signal to the obsidian
      // Plugin instance (optional calls — no dependency on core's new typing)
      onUserEnable: () => {
        instance?.onUserEnable?.();
      },
    };

    /* 4. register; enabled mirrors community-plugins.json (fixture opts in) */
    const enabled = enabledIds.includes(id) || (fixtureRequested && id === FIXTURE_PLUGIN_ID);
    try {
      await plugins.register(wrapper, "obsidian", {
        enabled,
        persistEnabled: (on) => persistEnabledId(vault, id, on),
        installDir: source.dir, // R166: real folder name (may differ from id) for uninstall
      });
      loadedIds.push(id);
    } catch (err) {
      console.error(`[obsidian-compat] ${id}: registration failed`, err);
      return {
        id,
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
        ...(minAppWarning ? { minAppWarning } : {}),
      };
    }
    if (enabled && !plugins.isEnabled(id)) {
      // PluginManager caught the onload failure — surface the captured reason
      // (R258: getLastError carries the real message, not just "see error above")
      return {
        id,
        status: "failed",
        detail: plugins.getLastError(id) ?? "onload failed (see error above)",
        ...(minAppWarning ? { minAppWarning } : {}),
      };
    }
    return {
      id,
      status: enabled ? "enabled" : "disabled",
      ...(minAppWarning ? { minAppWarning } : {}),
    };
  }
}

/* ---------------- status report ---------------- */

function logReport(report: ObsidianPluginReport[]): void {
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
