/**
 * R88 line-number gutter + default new-tab mode E2E — browser mode :1420.
 * Run: node .calibration/r88-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 88 additions" (㊶ 续).
 *
 * Covers the showLineNumbers CM compartment reactively toggling the gutter +
 * persistence, and defaultNewTabMode driving the mode a new tab opens in.
 * Pure front-end, no .md writes.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r88", name: "r88", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeNewTabMode, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);
const hasLineNumbers = () => app(() => !!document.querySelector('.cm-editor .cm-lineNumbers'));

// open a note in live mode (a CM view exists)
await create("ln.md", "# line numbers\n\nbody one\nbody two\n");
await app(async () => {
  window.__app.workspace.openFile("ln.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 300));
});

// ── line-number gutter (reactive toggle) ────────────────────────────────────
console.log("— line-number gutter —");
ok("no line-number gutter by default (Obsidian default OFF)", !(await hasLineNumbers()));
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 250)); });
ok("line-numbers toggle present", await app(() => !!document.querySelector('[data-testid="settings-line-numbers-toggle"]')));
await page.click('[data-testid="settings-line-numbers-toggle"]');
await wait(120);
ok("toggle persists to localStorage (true)", (await ls("geode.showLineNumbers")) === "true");
await app(() => window.__app.workspace.closeModal());
await wait(200);
ok("line-number gutter appears reactively after enabling", await hasLineNumbers());
// the line-number gutter coexists with the R17 fold gutter, and is leftmost
ok("line-number gutter coexists with the fold gutter, leftmost", await app(() => {
  const gutters = [...document.querySelectorAll('.cm-editor .cm-gutters .cm-gutter')];
  const ln = gutters.findIndex((g) => g.classList.contains("cm-lineNumbers"));
  const fold = gutters.findIndex((g) => g.classList.contains("cm-foldGutter"));
  return ln !== -1 && fold !== -1 && ln < fold; // both present, line numbers before fold
}));
// toggle off → gutter gone
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 200)); });
await page.click('[data-testid="settings-line-numbers-toggle"]');
await wait(120);
await app(() => window.__app.workspace.closeModal());
await wait(200);
ok("line-number gutter disappears reactively after disabling", !(await hasLineNumbers()));
ok("toggle off persists (false)", (await ls("geode.showLineNumbers")) === "false");

// ── default new-tab mode ────────────────────────────────────────────────────
console.log("— default new-tab mode —");
await create("nt1.md", "# nt1\n");
await create("nt2.md", "# nt2\n");
await create("nt3.md", "# nt3\n");
// truth table via the probe hook (sets mode + opens + returns tab.mode)
ok("default-mode preview → new tab opens in preview", (await app(([p]) => window.__geodeNewTabMode("preview", p), ["nt1.md"])) === "preview");
ok("default-mode source → new tab opens in source", (await app(([p]) => window.__geodeNewTabMode("source", p), ["nt2.md"])) === "source");
ok("default-mode live → new tab opens in live", (await app(([p]) => window.__geodeNewTabMode("live", p), ["nt3.md"])) === "live");

// via the settings segmented UI → openFile newTab
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 200)); });
ok("default-mode segmented control present", await app(() => !!document.querySelector('[data-testid="settings-newtab-reading"]')));
await page.click('[data-testid="settings-newtab-reading"]');
await wait(120);
ok("segmented Reading persists (preview)", (await ls("geode.defaultNewTabMode")) === "preview");
await app(() => window.__app.workspace.closeModal());
await create("nt4.md", "# nt4\n");
const tabMode = await app(async ([p]) => {
  window.__app.workspace.openFile(p, { newTab: true });
  await new Promise((r) => setTimeout(r, 150));
  return window.__app.workspace.getActiveTab()?.mode;
}, ["nt4.md"]);
ok("opening a new tab via UI default uses preview mode", tabMode === "preview", tabMode);

console.log(`\nR88 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
