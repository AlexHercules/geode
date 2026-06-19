/**
 * R100 Show tab title bar + Show status bar E2E — browser mode :1420.
 * Run: node .calibration/r100-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 100 additions" (㊺ 续续续).
 *
 * Two appearance toggles (default ON = Obsidian + zero regression), mirroring R94's
 * inline-title/ribbon: hide each pane's tab strip / the bottom status bar. Hiding the
 * tab bar must NOT lose the tabs (still switchable). Pure front-end, no .md writes.
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
  localStorage.removeItem("geode.showTabTitleBar");
  localStorage.removeItem("geode.showStatusBar");
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r100", name: "r100", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeAppearance, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);
const hasTabBar = () => app(() => !!document.querySelector('[data-testid^="tab-bar-"]'));
const hasStatusBar = () => app(() => !!document.querySelector('[data-testid="status-bar"]'));
const openSettings = () => app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 250)); });
const closeModal = () => app(() => window.__app.workspace.closeModal());

// open a file so a pane + tab bar exist
await create("doc.md", "# doc\n");
await app(async () => { window.__app.workspace.openFile("doc.md"); await new Promise((r) => setTimeout(r, 200)); });

// ── tab title bar (default ON) ──────────────────────────────────────────────
console.log("— tab title bar —");
ok("tab bar shown by default", await hasTabBar());
const tabsBefore = await app(() => window.__app.workspace.getActiveTab()?.filePath);
await openSettings();
ok("tab-title-bar toggle present", await app(() => !!document.querySelector('[data-testid="settings-tab-title-bar-toggle"]')));
await page.click('[data-testid="settings-tab-title-bar-toggle"]');
await wait(120);
ok("toggle off persists (false)", (await ls("geode.showTabTitleBar")) === "false");
await closeModal();
await wait(150);
ok("tab bar hidden reactively when off", !(await hasTabBar()));
ok("hiding the tab bar does NOT lose the open tab (still switchable)",
  (await app(() => window.__app.workspace.getActiveTab()?.filePath)) === tabsBefore);
// toggle back on
await openSettings();
await page.click('[data-testid="settings-tab-title-bar-toggle"]');
await wait(120);
await closeModal();
await wait(150);
ok("tab bar reappears when re-enabled", await hasTabBar());
ok("toggle on persists (true)", (await ls("geode.showTabTitleBar")) === "true");

// ── status bar (default ON) ─────────────────────────────────────────────────
console.log("— status bar —");
ok("status bar shown by default", await hasStatusBar());
await openSettings();
ok("status-bar toggle present", await app(() => !!document.querySelector('[data-testid="settings-status-bar-toggle"]')));
await page.click('[data-testid="settings-status-bar-toggle"]');
await wait(120);
ok("status-bar off persists (false)", (await ls("geode.showStatusBar")) === "false");
await closeModal();
await wait(150);
ok("status bar hidden reactively when off", !(await hasStatusBar()));
// re-enable via the probe (status bar is hidden but the setter still drives it)
await app(() => window.__geodeAppearance.setChrome(true, true));
await wait(150);
ok("status bar reappears when re-enabled", await hasStatusBar());
ok("status-bar on persists (true)", (await ls("geode.showStatusBar")) === "true");

// ── probe round-trip (proves the real Store path) ───────────────────────────
console.log("— probe round-trip —");
ok("setChrome(false,false) returns both false", await app(() => {
  const r = window.__geodeAppearance.setChrome(false, false);
  return r.tabTitleBar === false && r.statusBar === false;
}));
ok("setChrome(true,true) returns both true", await app(() => {
  const r = window.__geodeAppearance.setChrome(true, true);
  return r.tabTitleBar === true && r.statusBar === true;
}));

console.log(`\nR100 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
