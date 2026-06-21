/**
 * R166 — Tier 7 B1: uninstall community (obsidian) plugin — browser :1420.
 * Run: node .calibration/r166-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 166 additions" (Tier 7 B1).
 *
 * PluginManager.uninstall(id): removeRecord → persistEnabled(false) → vault.remove
 * (.obsidian/plugins/<id>). Scoped to source==="obsidian"; id validated single safe
 * segment. DATA-SAFETY: spy verifies the delete targets ONLY .obsidian/plugins/<id>.
 * MemoryVaultAdapter reads obsidian plugins from __geodeObsidianPlugins (seeded below).
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("dialog", (d) => d.accept()); // confirmDelete (browser → window.confirm)

// seed an installed + enabled obsidian community plugin BEFORE boot
await page.addInitScript(() => {
  const mainJs = "const { Plugin } = require('obsidian'); module.exports = class extends Plugin { onload(){} onunload(){} };";
  window.__geodeObsidianPlugins = [
    {
      dir: "r166-test",
      manifestJson: JSON.stringify({ id: "r166-test", name: "R166 Test Plugin", version: "1.0.0", minAppVersion: "0.0.1" }),
      mainJs, stylesCss: null, dataJson: null,
    },
    {
      // D1 regression: on-disk folder name differs from the manifest id — uninstall
      // MUST delete the folder (dir), not the id
      dir: "r166-folder",
      manifestJson: JSON.stringify({ id: "r166-mismatch-id", name: "R166 Mismatch", version: "1.0.0", minAppVersion: "0.0.1" }),
      mainJs, stylesCss: null, dataJson: null,
    },
  ];
  window.__geodeObsidianConfig = { "community-plugins.json": '["r166-test","r166-mismatch-id"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
});
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const inList = (id) => ev((x) => window.geode.app.plugins.list().some((e) => e.plugin.id === x), id);
const entryOf = (id) => ev((x) => window.geode.app.plugins.list().find((e) => e.plugin.id === x) ?? null, id);

console.log("— seeded obsidian plugin loaded as community plugin —");
const seeded = await entryOf("r166-test");
ok("r166-test loaded", seeded !== null);
ok("r166-test source === 'obsidian'", seeded?.source === "obsidian");
ok("r166-test enabled (in community-plugins.json)", seeded?.enabled === true);

console.log("— UI: uninstall button on obsidian plugins, NOT on builtin —");
await ev(() => window.geode.app.workspace.openModal("settings"));
await page.waitForSelector("[data-testid=settings-modal]", { timeout: 5000 });
await page.click("[data-testid=settings-nav-plugins]");
await wait(80);
ok("uninstall button present for the obsidian plugin",
  await page.$("[data-testid=plugin-uninstall-r166-test]").then((h) => !!h));
const builtinId = await ev(() => window.geode.app.plugins.list().find((e) => e.source === "builtin")?.plugin.id ?? null);
ok("a builtin plugin exists to compare", builtinId !== null);
ok("builtin plugin has NO uninstall button", await ev((id) =>
  document.querySelector(`[data-testid=plugin-uninstall-${id}]`) === null, builtinId));

console.log("— spy vault.remove, then uninstall via the button —");
await ev(() => {
  window.__removeCalls = [];
  const v = window.geode.app.vault;
  const orig = v.remove.bind(v);
  v.remove = (p) => { window.__removeCalls.push(p); return orig(p); };
});
await page.click("[data-testid=plugin-uninstall-r166-test]");
await wait(300); // confirm + removeRecord + persistEnabled + vault.remove

ok("plugin removed from the registry list", !(await inList("r166-test")));
ok("vault.remove called with the confined plugin path (.obsidian/plugins/r166-test)",
  await ev(() => window.__removeCalls.includes(".obsidian/plugins/r166-test")));
ok("vault.remove never targeted anything outside .obsidian/plugins/",
  await ev(() => window.__removeCalls.every((p) => p === ".obsidian/plugins/r166-test")));
ok("dropped from community-plugins.json",
  await ev(async () => {
    const raw = await window.geode.app.vault.adapter.readConfig("community-plugins.json");
    const list = raw ? JSON.parse(raw) : [];
    return !list.includes("r166-test");
  }));

console.log("— D1: uninstall deletes the on-disk dir, not the manifest id (dir !== id) —");
await ev(() => { window.__removeCalls = []; });
ok("mismatch plugin loaded by manifest id", await inList("r166-mismatch-id"));
await ev(() => window.geode.app.plugins.uninstall("r166-mismatch-id"));
await wait(200);
ok("mismatch plugin removed from registry", !(await inList("r166-mismatch-id")));
ok("vault.remove targeted the FOLDER (.obsidian/plugins/r166-folder), not the id",
  await ev(() => window.__removeCalls.includes(".obsidian/plugins/r166-folder")));
ok("vault.remove did NOT target the manifest id path",
  await ev(() => !window.__removeCalls.includes(".obsidian/plugins/r166-mismatch-id")));

console.log("— guards: non-obsidian source + nonexistent id are no-ops —");
await ev(() => { window.__removeCalls = []; });
await ev((id) => window.geode.app.plugins.uninstall(id), builtinId); // source !== obsidian
await wait(100);
ok("uninstall on a builtin is a no-op (still in list)", await inList(builtinId));
ok("uninstall on a builtin did not call vault.remove", await ev(() => window.__removeCalls.length === 0));
await ev(() => window.geode.app.plugins.uninstall("nonexistent-xyz"));
await wait(60);
ok("uninstall on a nonexistent id is a no-op (no remove call)", await ev(() => window.__removeCalls.length === 0));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR166: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
