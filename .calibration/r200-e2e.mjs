/**
 * R200 — G3 missing→done: editor right-click context menu native Cut/Copy/Paste + always-show.
 * Completes R131's deferred slice (compat/obsidian/editorMenu.ts). Browser :1420.
 * Run: node .calibration/r200-e2e.mjs   Contract: docs/ARCHITECTURE.md "Round 200 additions".
 *
 * Uses a SYNTHETIC contextmenu event dispatched on the CM contentDOM so a programmatic
 * selection is preserved (a real right-click would move the caret). Clipboard perms granted.
 * R252 added file-action items AFTER the clipboard items, so assertions about the exact menu
 * contents were updated to "Cut/Copy/Paste first, file-actions next, plugin items LAST".
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
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r200", name: "r200", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });
// register the editor-menu handler on the COMPAT workspace (the one editorMenu.ts triggers)
await page.evaluate(() => {
  window.__pluginFired = null;
  window.__addPluginItem = false;
  window.__addBareSeparator = false;
  window.app.workspace.on("editor-menu", (menu) => {
    if (window.__addPluginItem) {
      menu.addItem((item) => item.setTitle("Plugin Item").onClick(() => { window.__pluginFired = true; }));
    } else if (window.__addBareSeparator) {
      menu.addSeparator(); // pathological: plugin contributes ONLY a separator (no item)
    }
  });
});

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(async () => { try { await window.__app.vault.create("r200.md", "alpha beta gamma\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r200.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);

const setSel = (anchor, head) => app(([a, h]) => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: a, head: h } }), [anchor, head]);
const docStr = () => app(() => window.__app.documents.getActiveView().view.state.doc.toString());
const ctxMenu = () => app(() => {
  const v = window.__app.documents.getActiveView().view;
  const r = v.contentDOM.getBoundingClientRect();
  v.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 8 }));
});
const menuLabels = () => page.$$eval('[data-testid="compat-menu-item"]', (els) => els.map((e) => e.textContent.trim()));
const itemDisabled = (label) => page.$$eval('[data-testid="compat-menu-item"]', (els, l) => {
  const it = els.find((e) => e.textContent.trim() === l);
  return it ? it.classList.contains("is-disabled") : null;
}, label);
const hasSeparator = () => page.$('[data-testid="compat-menu"] .menu-separator').then((e) => e !== null);
const clickItem = (label) => page.$$eval('[data-testid="compat-menu-item"]', (els, l) => {
  const it = els.find((e) => e.textContent.trim() === l);
  if (it) it.click();
}, label);
const menuGone = () => app(() => document.querySelector('[data-testid="compat-menu"]') === null);
const closeMenu = async () => { await page.keyboard.press("Escape").catch(() => {}); await app(() => document.querySelector('[data-testid="compat-menu"]')?.remove()); };
const clip = () => app(() => navigator.clipboard.readText());

console.log("A. always-show + native items + selection-gated disabled state");
await setSel(0, 0); // no selection
await ctxMenu();
await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
let labels = await menuLabels();
ok("menu shows on right-click even with NO plugin item (always-show)", labels.length >= 3, JSON.stringify(labels));
ok("native items are Cut / Copy / Paste in order", labels[0] === "Cut" && labels[1] === "Copy" && labels[2] === "Paste", JSON.stringify(labels));
ok("Cut disabled when no selection", (await itemDisabled("Cut")) === true);
ok("Copy disabled when no selection", (await itemDisabled("Copy")) === true);
ok("Paste enabled always", (await itemDisabled("Paste")) === false);
ok("R252: file-action items follow the clipboard items (>3 total)", labels.length > 3, JSON.stringify(labels));
await closeMenu();

console.log("B. with a selection → Cut/Copy enabled; Copy writes clipboard");
await setSel(6, 10); // "beta"
await ctxMenu();
await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
ok("Cut enabled with selection", (await itemDisabled("Cut")) === false);
ok("Copy enabled with selection", (await itemDisabled("Copy")) === false);
await clickItem("Copy");
await wait(120);
ok("menu closes after clicking Copy", (await menuGone()) === true);
ok("Copy wrote the selection 'beta' to the clipboard", (await clip()) === "beta", await clip());
ok("Copy did NOT mutate the doc", (await docStr()) === "alpha beta gamma\n", await docStr());

console.log("C. Cut removes the selection + writes clipboard + is undoable");
await setSel(6, 10);
await ctxMenu();
await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
await clickItem("Cut");
await wait(150);
ok("Cut removed 'beta' → 'alpha  gamma'", (await docStr()) === "alpha  gamma\n", await docStr());
ok("Cut wrote 'beta' to the clipboard", (await clip()) === "beta", await clip());
await app(() => window.__app.documents.getActiveView().view.focus());
await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
await wait(120);
ok("Cut is undoable (Ctrl/Cmd-Z restores 'beta')", (await docStr()) === "alpha beta gamma\n", await docStr());

console.log("D. Paste inserts the clipboard text at the caret");
await app(() => navigator.clipboard.writeText("XYZ"));
await setSel(0, 0); // caret at start
await ctxMenu();
await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
await clickItem("Paste");
await wait(150);
ok("Paste inserted 'XYZ' at the caret", (await docStr()) === "XYZalpha beta gamma\n", await docStr());
// undo the paste to restore for later runs idempotency
await app(() => window.__app.documents.getActiveView().view.focus());
await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
await wait(120);

console.log("E. plugin editor-menu items still appear after the native items + separator");
await app(() => { window.__addPluginItem = true; window.__pluginFired = null; });
await setSel(0, 0);
await ctxMenu();
await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
labels = await menuLabels();
ok("plugin editor-menu item appears LAST (after natives + R252 file-actions)", labels[labels.length - 1] === "Plugin Item" && labels.slice(0, 3).join(",") === "Cut,Copy,Paste", JSON.stringify(labels));
ok("separator present between native and plugin items", (await hasSeparator()) === true);
await clickItem("Plugin Item");
await wait(120);
ok("clicking the plugin item runs its onClick", (await app(() => window.__pluginFired)) === true);

console.log("F. a plugin contributing ONLY a bare separator leaves no dangling/orphan rule");
await app(() => { window.__addPluginItem = false; window.__addBareSeparator = true; });
await setSel(0, 0);
await ctxMenu();
await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
labels = await menuLabels();
ok("bare-separator plugin → no plugin item added (only natives + R252 file-actions)", !labels.includes("Plugin Item") && labels.slice(0, 3).join(",") === "Cut,Copy,Paste", JSON.stringify(labels));
ok("bare-separator plugin → no dangling trailing separator (last child is an item)", await app(() => { const m = document.querySelector('[data-testid="compat-menu"]'); return !!m && !m.lastElementChild?.classList.contains("menu-separator"); }), "trailing separator not stripped");
await closeMenu();

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR200: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
