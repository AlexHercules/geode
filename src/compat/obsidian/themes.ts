/**
 * Obsidian theme/snippet CSS compatibility layer (R20).
 *
 * Three pieces (see ARCHITECTURE.md Round 20):
 *  1. variable bridge  — injected stylesheet mapping Obsidian CSS variables
 *     onto Geode's palette (identity by default: zero visual change with no
 *     theme installed),
 *  2. theme loading    — `.obsidian/themes/<dir>/theme.css` per
 *     appearance.json `cssTheme`,
 *  3. snippet loading  — `.obsidian/snippets/*.css` per
 *     appearance.json `enabledCssSnippets`.
 *
 * Master switch persisted in localStorage `geode.obsidianCss` ("on"/"off",
 * default on). Style elements (frozen ids/attrs):
 *   <style id="geode-obsidian-bridge">
 *   <style id="geode-obsidian-theme" data-theme-dir="<dir>">
 *   <style data-obsidian-snippet="<name>">
 * Injection order bridge → theme → snippets; any change removes all three
 * groups and re-appends in order.
 *
 * The body `.theme-dark`/`.theme-light` classes are RESIDENT (synced with the
 * Geode theme, never removed by the master switch) — they are the scope
 * anchors for theme/snippet CSS and inert without it. All exported functions
 * swallow failures with console.warn (never throw into caller UI).
 */
import type { Vault } from "@core/vault";
import type { EventBus } from "@core/events";
import type { Workspace } from "@core/workspace";
import { Store } from "@core/store";
import { obsidianLoadReport } from "./loader";
import bridgeCss from "./theme-bridge.css?raw";

export interface ObsidianCssTheme {
  /** folder name under .obsidian/themes */
  dir: string;
  /** display name from manifest.json `name`, falling back to dir */
  name: string;
}

export interface ObsidianCssSnippet {
  /** file name under .obsidian/snippets without the .css extension */
  name: string;
  enabled: boolean;
}

export interface ObsidianCssState {
  enabled: boolean;
  themes: ReadonlyArray<ObsidianCssTheme>;
  /** active theme dir per appearance.json cssTheme; "" = none */
  activeTheme: string;
  snippets: ReadonlyArray<ObsidianCssSnippet>;
}

export const obsidianCssState = new Store<ObsidianCssState>({
  enabled: true,
  themes: [],
  activeTheme: "",
  snippets: [],
});

export interface ObsidianCssContext {
  vault: Vault;
  events: EventBus;
  workspace: Workspace;
}

/* ---------------- module state ---------------- */

const STORAGE_KEY = "geode.obsidianCss";
const BRIDGE_ID = "geode-obsidian-bridge";
const THEME_ID = "geode-obsidian-theme";
const SNIPPET_ATTR = "data-obsidian-snippet";
const APPEARANCE = "appearance.json";

let ctx: ObsidianCssContext | null = null;
/** EventBus we are currently subscribed to — re-init must NOT double-subscribe. */
let subscribedEvents: EventBus | null = null;
/** obsidianLoadReport subscription is process-lifetime; subscribe once. */
let loadReportSubscribed = false;
let unsubs: Array<() => void> = [];
/** Discovery caches, refilled on every init (re-injection without re-reading). */
let themeCssByDir = new Map<string, string>();
let snippetCssByName = new Map<string, string>();
/** Snippet INJECTION order = appearance.json enabledCssSnippets array order. */
let snippetOrder: string[] = [];

function readEnabledFlag(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off"; // default on
  } catch {
    return true;
  }
}

function syncBodyClass(theme: "dark" | "light"): void {
  document.body.classList.toggle("theme-dark", theme === "dark");
  document.body.classList.toggle("theme-light", theme === "light");
}

/* ---------------- injection (frozen DOM) ---------------- */

/**
 * Remove all three style groups, then re-append in the frozen order
 * bridge → theme → snippets. Order is guaranteed by rebuilding, never by
 * insertBefore adjustments. Master switch off → everything stays removed.
 */
function applyInjection(): void {
  document.getElementById(BRIDGE_ID)?.remove();
  document.getElementById(THEME_ID)?.remove();
  for (const el of Array.from(document.querySelectorAll(`style[${SNIPPET_ATTR}]`))) el.remove();

  const s = obsidianCssState.get();
  if (!s.enabled) return;

  const bridge = document.createElement("style");
  bridge.id = BRIDGE_ID;
  bridge.textContent = bridgeCss;
  document.head.appendChild(bridge);

  // an active theme missing from the discovered set is NOT injected, but the
  // state keeps the value (Obsidian parity: deleting theme files on disk does
  // not clear the configured cssTheme)
  if (s.activeTheme !== "") {
    const css = themeCssByDir.get(s.activeTheme);
    if (css !== undefined) {
      const el = document.createElement("style");
      el.id = THEME_ID;
      el.setAttribute("data-theme-dir", s.activeTheme);
      el.textContent = css;
      document.head.appendChild(el);
    }
  }

  for (const name of snippetOrder) {
    const css = snippetCssByName.get(name);
    if (css === undefined) continue;
    const el = document.createElement("style");
    el.setAttribute(SNIPPET_ATTR, name);
    el.textContent = css;
    document.head.appendChild(el);
  }
}

/* ---------------- appearance.json ---------------- */

async function readAppearance(vault: Vault): Promise<Record<string, unknown>> {
  try {
    const raw = await vault.adapter.readConfig(APPEARANCE);
    if (raw === null) {
      console.warn(`[obsidian-css] ${APPEARANCE} missing — using defaults`);
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    console.warn(`[obsidian-css] ${APPEARANCE} is not a JSON object — using defaults`);
    return {};
  } catch (err) {
    console.warn(`[obsidian-css] failed to read ${APPEARANCE} — using defaults`, err);
    return {};
  }
}

/** Serialized read-modify-write preserving unknown keys (loader.ts precedent). */
let appearanceChain: Promise<void> = Promise.resolve();

function persistAppearance(
  vault: Vault,
  mutate: (obj: Record<string, unknown>) => void,
): Promise<void> {
  const run = appearanceChain.then(async () => {
    // Security F-01: a missing file is created from {}, but an UNREADABLE or
    // malformed existing file ABORTS the write — rewriting from {} would
    // silently erase every key Obsidian itself wrote (theme, accentColor, …).
    let obj: Record<string, unknown> = {};
    const raw = await vault.adapter.readConfig(APPEARANCE);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw); // throws → abort (fail visible)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${APPEARANCE} is not a JSON object — refusing to overwrite`);
      }
      obj = parsed as Record<string, unknown>;
    }
    mutate(obj);
    await vault.adapter.writeConfig(APPEARANCE, JSON.stringify(obj, null, 2));
  });
  appearanceChain = run.catch(() => undefined);
  return run;
}

/* ---------------- single mutation chain (init + all setters) ----------------
 * R20-LC-1/LC-2 fix: EVERY state mutation (re-init, theme select, snippet
 * toggle, master switch) is serialized on one promise chain, so a setter can
 * never interleave with a running init (whose final state.set would clobber
 * the setter) and two snippet toggles can never compute from the same stale
 * snapshot. */

let opChain: Promise<void> = Promise.resolve();

function enqueue(label: string, op: () => Promise<void> | void): Promise<void> {
  const run = opChain.then(async () => {
    try {
      await op();
    } catch (err) {
      console.warn(`[obsidian-css] ${label} failed`, err);
    }
  });
  opChain = run;
  return run;
}

/** Discover themes/snippets, apply appearance.json, sync body theme classes.
 *  Idempotent — calling again re-discovers and re-applies. */
export function initObsidianCss(c: ObsidianCssContext): Promise<void> {
  return enqueue("init", () => runInit(c));
}

async function runInit(c: ObsidianCssContext): Promise<void> {
  ctx = c;
  (window as unknown as Record<string, unknown>).__geodeObsidianCssReinit = () =>
    initObsidianCss(c);

  // body class sync — resident, follows the Geode theme regardless of switch
  syncBodyClass(c.workspace.state.get().theme === "light" ? "light" : "dark");
  if (subscribedEvents !== c.events) {
    for (const u of unsubs.splice(0)) u();
    subscribedEvents = c.events;
    unsubs.push(
      c.events.on("theme:changed", ({ theme }) => syncBodyClass(theme)),
      // reason "load" = the vault ROOT switched (documents.ts precedent) —
      // full re-discovery + re-injection; per-file events don't re-discover
      // (.obsidian is outside the watcher surface anyway)
      c.events.on("vault:changed", ({ reason }) => {
        if (reason === "load" && ctx) void initObsidianCss(ctx);
      }),
    );
  }
  // R20-LC-3/CC-5 fix: plugin (re)loads append their styles.css to head AFTER
  // our groups — re-appending on every load-report change restores the frozen
  // invariant "plugin styles before bridge/theme/snippets" (rebuild keeps our
  // relative order, appending moves us behind the plugin styles again).
  if (!loadReportSubscribed) {
    loadReportSubscribed = true;
    obsidianLoadReport.subscribe(() => applyInjection());
  }

  const enabled = readEnabledFlag();
  themeCssByDir = new Map();
  snippetCssByName = new Map();
  snippetOrder = [];

  if (!c.vault.isOpen) {
    obsidianCssState.set({ enabled, themes: [], activeTheme: "", snippets: [] });
    applyInjection();
    return;
  }
  const adapter = c.vault.adapter;

  /* discovery: themes */
  const themes: ObsidianCssTheme[] = [];
  let themeEntries: Array<{ name: string; isDir: boolean }> = [];
  try {
    themeEntries = await adapter.listConfigDir("themes");
  } catch (err) {
    console.warn("[obsidian-css] failed to list themes", err);
  }
  for (const entry of themeEntries) {
    if (!entry.isDir) continue;
    let css: string | null = null;
    try {
      css = await adapter.readConfig(`themes/${entry.name}/theme.css`);
    } catch (err) {
      console.warn(`[obsidian-css] failed to read themes/${entry.name}/theme.css`, err);
    }
    if (css === null) continue; // theme.css missing → directory skipped
    let name = entry.name;
    try {
      const rawManifest = await adapter.readConfig(`themes/${entry.name}/manifest.json`);
      if (rawManifest !== null) {
        const parsed: unknown = JSON.parse(rawManifest);
        const mName = (parsed as { name?: unknown } | null)?.name;
        if (typeof mName === "string" && mName.trim().length > 0) name = mName;
      }
    } catch (err) {
      console.warn(
        `[obsidian-css] themes/${entry.name}/manifest.json unreadable — using dir name`,
        err,
      );
    }
    themeCssByDir.set(entry.name, css);
    themes.push({ dir: entry.name, name });
  }

  /* discovery: snippets */
  let snippetEntries: Array<{ name: string; isDir: boolean }> = [];
  try {
    snippetEntries = await adapter.listConfigDir("snippets");
  } catch (err) {
    console.warn("[obsidian-css] failed to list snippets", err);
  }
  for (const entry of snippetEntries) {
    if (entry.isDir || !entry.name.toLowerCase().endsWith(".css")) continue;
    const name = entry.name.slice(0, -".css".length);
    let css: string | null = null;
    try {
      css = await adapter.readConfig(`snippets/${entry.name}`);
    } catch (err) {
      console.warn(`[obsidian-css] failed to read snippets/${entry.name}`, err);
    }
    if (css === null) continue;
    snippetCssByName.set(name, css);
  }

  /* appearance.json */
  const appearance = await readAppearance(c.vault);
  const activeTheme = typeof appearance.cssTheme === "string" ? appearance.cssTheme : "";
  const enabledSnippets = Array.isArray(appearance.enabledCssSnippets)
    ? appearance.enabledCssSnippets.filter((x): x is string => typeof x === "string")
    : [];
  snippetOrder = enabledSnippets;

  obsidianCssState.set({
    enabled,
    themes,
    activeTheme,
    snippets: Array.from(snippetCssByName.keys(), (name) => ({
      name,
      enabled: enabledSnippets.includes(name),
    })),
  });
  applyInjection();
}

/* ---------------- setters (never throw into caller UI) ---------------- */

/** Master switch; persists to localStorage and injects/removes all CSS. */
export function setObsidianCssEnabled(on: boolean): Promise<void> {
  return enqueue("setObsidianCssEnabled", () => {
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch (err) {
      console.warn("[obsidian-css] failed to persist master switch", err);
    }
    obsidianCssState.update((s) => ({ ...s, enabled: on }));
    applyInjection();
  });
}

/** Activate theme by dir ("" clears); persists appearance.json cssTheme. */
export function setObsidianTheme(dir: string): Promise<void> {
  return enqueue("setObsidianTheme", async () => {
    if (ctx?.vault.isOpen) {
      await persistAppearance(ctx.vault, (obj) => {
        obj.cssTheme = dir;
      });
    }
    obsidianCssState.update((s) => ({ ...s, activeTheme: dir }));
    applyInjection();
  });
}

/** Enable/disable a snippet; persists appearance.json enabledCssSnippets. */
export function setObsidianSnippet(name: string, on: boolean): Promise<void> {
  return enqueue("setObsidianSnippet", async () => {
    // R20-LC-1 fix: the next array is computed INSIDE the read-modify-write
    // from the freshly read appearance object, never from a pre-await
    // snapshot — concurrent toggles each see the previous one's write.
    let next: string[] = snippetOrder;
    const toggle = (cur: string[]): string[] =>
      on ? (cur.includes(name) ? cur : [...cur, name]) : cur.filter((x) => x !== name);
    if (ctx?.vault.isOpen) {
      await persistAppearance(ctx.vault, (obj) => {
        const cur = Array.isArray(obj.enabledCssSnippets)
          ? obj.enabledCssSnippets.filter((x): x is string => typeof x === "string")
          : [];
        next = toggle(cur);
        obj.enabledCssSnippets = next;
      });
    } else {
      next = toggle(snippetOrder);
    }
    snippetOrder = next;
    obsidianCssState.update((s) => ({
      ...s,
      snippets: s.snippets.map((sn) => (sn.name === name ? { ...sn, enabled: on } : sn)),
    }));
    applyInjection();
  });
}
