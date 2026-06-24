/**
 * R195 — G3 missing→done: app:toggle-default-new-tab-view (Obsidian
 * app:toggle-default-new-tab-view) — browser :1420.
 * Run: node .calibration/r195-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 195 additions".
 *
 * Geode merges Obsidian's view + editing-mode settings into one NewTabMode tri-state, so
 * the command cycles all three (live → source → preview → live). Pure appearance setting:
 * it flips defaultNewTabMode + persists to localStorage; no document/vault write.
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
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => {
  localStorage.setItem("geode.locale", "en");
  localStorage.setItem("geode.defaultNewTabMode", "live"); // deterministic start
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r195", name: "r195", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (id) => app(([cid]) => window.__app.commands.execute(cid), [id]);
const mode = () => app(() => localStorage.getItem("geode.defaultNewTabMode"));

console.log("— command registered + name resolves + no default hotkey —");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "app:toggle-default-new-tab-view");
  return { present: !!c, name: c ? c.name() : null, hk: window.__app.commands.getEffectiveHotkey("app:toggle-default-new-tab-view") || null };
});
ok("app:toggle-default-new-tab-view registered", reg.present);
ok("name resolves (not raw key)", !!reg.name && !reg.name.startsWith("cmd."), reg.name);
ok("has no default hotkey (Obsidian parity)", reg.hk === null, reg.hk);

console.log("— cycles live → source → preview → live (all 3 modes reachable) —");
ok("starts at live", (await mode()) === "live", await mode());
await exec("app:toggle-default-new-tab-view");
await wait(60);
ok("live → source", (await mode()) === "source", await mode());
await exec("app:toggle-default-new-tab-view");
await wait(60);
ok("source → preview", (await mode()) === "preview", await mode());
await exec("app:toggle-default-new-tab-view");
await wait(60);
ok("preview → live (wraps)", (await mode()) === "live", await mode());

console.log("— the setting persists to localStorage (survives a reload) —");
await exec("app:toggle-default-new-tab-view"); // → source
await wait(60);
ok("persisted value is source before reload", (await mode()) === "source");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
ok("persisted value still source after reload", (await mode()) === "source", await mode());
// re-register the probe plugin (reload dropped window.__app)
await page.evaluate(() => window.geode.registerPlugin({ id: "r195b", name: "r195b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

console.log("— no active file needed (pure appearance command) —");
await app(() => window.__app.workspace.openGraph());
await wait(120);
const before = await mode();
await exec("app:toggle-default-new-tab-view");
await wait(60);
ok("toggle works on a graph tab (no active file)", (await mode()) !== before);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR195: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
