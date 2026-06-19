/**
 * R94 Show inline title + Show ribbon E2E — browser mode :1420.
 * Run: node .calibration/r94-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 94 additions" (㊺ 续续).
 *
 * Inline title = the note filename as an H1 atop the editor + reading view (default
 * ON = Obsidian). Display-only (no edit→rename in v1). Ribbon toggle hides the left
 * primary nav (default ON). Pure front-end, no .md writes.
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
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => {
  localStorage.setItem("geode.locale", "en");
  localStorage.removeItem("geode.showInlineTitle"); // observe the ON default
  localStorage.removeItem("geode.showRibbon");
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r94", name: "r94", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeAppearance, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);
const inlineTitleText = () => app(() => document.querySelector('[data-testid="inline-title"]')?.textContent ?? null);
const hasRibbon = () => app(() => !!document.querySelector(".ribbon.side-dock-ribbon"));
const setMode = (m) => app(async ([mode]) => {
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, mode);
  await new Promise((r) => setTimeout(r, 250));
}, [m]);

// open a note in live mode
await create("Welcome.md", "# Heading\n\nbody text\n");
await app(async () => { window.__app.workspace.openFile("Welcome.md"); await new Promise((r) => setTimeout(r, 300)); });
await setMode("live");

// ── inline title (default ON) ───────────────────────────────────────────────
console.log("— inline title —");
ok("inline title shows the basename in live mode (default ON)", (await inlineTitleText()) === "Welcome");
await setMode("preview");
ok("inline title shows the basename in reading view", (await inlineTitleText()) === "Welcome");
await setMode("source");
ok("inline title shows in source mode too", (await inlineTitleText()) === "Welcome");
// toggle OFF via settings
await setMode("live");
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 250)); });
ok("inline-title toggle present", await app(() => !!document.querySelector('[data-testid="settings-inline-title-toggle"]')));
await page.click('[data-testid="settings-inline-title-toggle"]');
await wait(120);
ok("toggle off persists (false)", (await ls("geode.showInlineTitle")) === "false");
await app(() => window.__app.workspace.closeModal());
await wait(150);
ok("inline title disappears reactively when off", (await inlineTitleText()) === null);
// toggle back ON
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 200)); });
await page.click('[data-testid="settings-inline-title-toggle"]');
await wait(120);
await app(() => window.__app.workspace.closeModal());
await wait(150);
ok("inline title reappears when re-enabled", (await inlineTitleText()) === "Welcome");
ok("toggle on persists (true)", (await ls("geode.showInlineTitle")) === "true");

// ── ribbon toggle (default ON) ──────────────────────────────────────────────
console.log("— ribbon toggle —");
ok("ribbon visible by default", await hasRibbon());
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 200)); });
ok("ribbon toggle present", await app(() => !!document.querySelector('[data-testid="settings-ribbon-toggle"]')));
await page.click('[data-testid="settings-ribbon-toggle"]');
await wait(120);
ok("ribbon-off persists (false)", (await ls("geode.showRibbon")) === "false");
await app(() => window.__app.workspace.closeModal());
await wait(150);
ok("ribbon hidden reactively when off", !(await hasRibbon()));
// re-enable via the probe (ribbon is hidden so its settings button is gone — Ctrl+, still works,
// but here we drive the setter directly to prove reactivity back on)
await app(() => window.__geodeAppearance.setToggles(true, true));
await wait(150);
ok("ribbon reappears when re-enabled", await hasRibbon());
ok("ribbon-on persists (true)", (await ls("geode.showRibbon")) === "true");

console.log(`\nR94 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
