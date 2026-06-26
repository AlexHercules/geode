/**
 * R131 compat workspace.on('editor-menu') E2E — browser mode :1420.
 * Run: node .calibration/r131-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 131 additions" (compat 商业主轴 · file-menu 大头 phase 2).
 *
 * Obsidian workspace.on('editor-menu', (menu, editor, info) => menu.addItem(...)) — plugins add items
 * to the editor right-click menu. Geode (no native editor menu) injects an always-on CM contextmenu
 * extension (via the R115 core registry) that fires 'editor-menu' + shows the REAL compat Menu when a
 * plugin contributed an item. R200 added native Cut/Copy/Paste + always-show, so the menu now ALSO
 * carries the 3 native items and shows even with no plugin contribution (assertions updated below).
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r131", name: "r131", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

// open a file + live mode + focus the editor so workspace.activeEditor resolves
await app(async () => {
  try { await window.__app.vault.create("edm.md", "alpha bravo charlie\nsecond line\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("edm.md");
});
await app(() => { const t = window.__app.workspace.getActiveTab(); if (t) window.__app.workspace.setTabMode(t.id, "live"); });
await page.waitForSelector(".cm-content", { timeout: 5000 });
await page.click(".cm-content");

// register an editor-menu handler (adds an item only when window.__addItems)
await app(() => {
  window.__addItems = true; window.__emFired = null; window.__emInfo = null; window.__emEditorOk = false;
  window.app.workspace.on("editor-menu", (menu, editor, info) => {
    window.__emInfo = info && info.file && info.file.path;
    window.__emEditorOk = !!(editor && typeof editor.getValue === "function" && typeof editor.getSelection === "function");
    if (window.__addItems) {
      menu.addItem((item) => item.setTitle("Editor Item").setIcon("star").onClick(() => { window.__emFired = "fired:" + (info && info.file && info.file.path); }));
    }
  });
});

console.log("— right-click in the editor fires editor-menu + shows the plugin's Menu —");
await page.click(".cm-content", { button: "right" });
const sawMenu = await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 }).then(() => true).catch(() => false);
ok("the compat Menu appears on editor right-click (with a plugin item)", sawMenu);
const ctx = await app(() => ({ info: window.__emInfo, editorOk: window.__emEditorOk }));
ok("the handler received the active MarkdownView info (file = edm.md)", ctx.info === "edm.md", JSON.stringify(ctx.info));
ok("the handler received a usable Editor (getValue + getSelection)", ctx.editorOk === true);
if (sawMenu) {
  const labels = await page.$$eval('[data-testid="compat-menu-item"]', (els) => els.map((e) => e.textContent.trim()));
  ok("R252: native Cut/Copy/Paste first, file-actions next, plugin 'Editor Item' LAST", labels.slice(0, 3).join(",") === "Cut,Copy,Paste" && labels[labels.length - 1].includes("Editor Item"), JSON.stringify(labels));
  await page.$$eval('[data-testid="compat-menu-item"]', (els) => { const it = els.find((e) => e.textContent.trim().includes("Editor Item")); if (it) it.click(); });
  const fired = await app(() => window.__emFired);
  ok("clicking the contributed item runs its onClick", fired === "fired:edm.md", JSON.stringify(fired));
  const gone = await page.$('[data-testid="compat-menu"]').then((el) => el === null);
  ok("the menu closes after clicking the item", gone);
}

console.log("— R200: with NO plugin item the compat Menu STILL shows (native Cut/Copy/Paste) —");
await app(() => { window.__addItems = false; });
// dismiss any leftover menu, then right-click again
await page.keyboard.press("Escape");
await app(() => document.querySelector('[data-testid="compat-menu"]')?.remove());
await page.click(".cm-content", { button: "right" });
const stillShows = await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 }).then(() => true).catch(() => false);
ok("R200: compat Menu shows native items even when no plugin contributes", stillShows === true);
const natLabels = await page.$$eval('[data-testid="compat-menu-item"]', (els) => els.map((e) => e.textContent.trim()));
ok("R252: native Cut/Copy/Paste are first 3 (R252 file-actions follow)", natLabels.slice(0, 3).join(",") === "Cut,Copy,Paste", JSON.stringify(natLabels));

console.log(`\nR131 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
