/**
 * R130 compat workspace.on('file-menu') E2E — browser mode :1420.
 * Run: node .calibration/r130-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 130 additions" (compat 商业主轴 · file-menu phase 1).
 *
 * Obsidian workspace.on('file-menu', (menu, file, source, leaf?) => menu.addItem(...)) — plugins add
 * items to file/folder context menus. Geode bridges via a CORE registry: compat registers ONE
 * provider (context.ts) that builds a CollectorMenu + fires the 'file-menu' event; the Explorer
 * (a feature) calls plugins.collectFileMenu(ctx) when opening its R93 menu and renders the items.
 * Two layers tested: the data path (collectFileMenu) + the Explorer UI (right-click → click).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r130", name: "r130", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace && !!window.app._geode && !!window.app._geode.plugins, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

// register a compat file-menu handler (what a plugin's onload would do) + create a file/folder
await app(async () => {
  window.__fired = null; window.__src = null; window.__filePath = null;
  window.app.workspace.on("file-menu", (menu, file, source, leaf) => {
    window.__src = source; window.__filePath = file && file.path; window.__leaf = leaf ?? null;
    menu.addItem((item) => item.setTitle("Star It").setIcon("star").setSection("action").onClick(() => { window.__fired = "star:" + (file && file.path); }));
    menu.addItem((item) => item.setTitle("Danger Zone").setWarning(true).onClick(() => { window.__fired = "danger"; }));
    menu.addSeparator(); // v1: dropped (host draws one sep before the group)
    menu.addItem((item) => item.setTitle("")); // empty title → dropped
  });
  try { await window.__app.vault.create("fmtarget.md", "# target\n"); } catch { /* exists */ }
  try { await window.__app.vault.createFolder("fmfolder"); } catch { /* exists */ }
});

console.log("— the data path: collectFileMenu fires the event + returns the contributions —");
const collected = await app(() => {
  const items = window.app._geode.plugins.collectFileMenu({ path: "fmtarget.md", isFolder: false, source: "file-explorer-context-menu" });
  const result = {
    titles: items.map((i) => i.title),
    icons: items.map((i) => i.icon ?? null),
    warnings: items.map((i) => !!i.warning),
    src: window.__src, file: window.__filePath,
  };
  items[0].onClick(); // fire the first item's closure
  result.fired = window.__fired;
  return result;
});
ok("empty-title item dropped + separator dropped → 2 items [Star It, Danger Zone]", eq(collected.titles, ["Star It", "Danger Zone"]), JSON.stringify(collected.titles));
ok("icon captured on the first item only", eq(collected.icons, ["star", null]), JSON.stringify(collected.icons));
ok("warning flag captured on 'Danger Zone'", eq(collected.warnings, [false, true]), JSON.stringify(collected.warnings));
ok("the handler received source = 'file-explorer-context-menu'", collected.src === "file-explorer-context-menu", JSON.stringify(collected.src));
ok("the handler received the right TFile (fmtarget.md)", collected.file === "fmtarget.md", JSON.stringify(collected.file));
ok("the item's onClick closure fires with the captured file", collected.fired === "star:fmtarget.md", JSON.stringify(collected.fired));

console.log("— a FOLDER context gets a TFolder —");
const folder = await app(() => {
  window.__filePath = null;
  window.app._geode.plugins.collectFileMenu({ path: "fmfolder", isFolder: true, source: "file-explorer-context-menu" });
  return window.__filePath;
});
ok("collectFileMenu(isFolder) passes the TFolder (fmfolder)", folder === "fmfolder", JSON.stringify(folder));

console.log("— no provider / unknown path → empty, never throws —");
const empty = await app(() => {
  let threw = false; let res = null;
  try { res = window.app._geode.plugins.collectFileMenu({ path: "does-not-exist.md", isFolder: false, source: "x" }); } catch { threw = true; }
  return { threw, len: res ? res.length : -1 };
});
ok("unknown path → [] (provider returns [] when registry has no file), no throw", empty.threw === false && empty.len === 0, JSON.stringify(empty));

console.log("— the Explorer UI renders + invokes the contributed items (right-click → click) —");
// right-click the file row, then assert the contributed button appears + clicking it fires onClick
await app(() => { window.__fired = null; });
const rowSel = '[title="fmtarget.md"]';
await page.waitForSelector(rowSel, { timeout: 5000 });
await page.click(rowSel, { button: "right" });
const sawButton = await page.waitForSelector('[data-testid="explorerctx-contributed"]', { timeout: 3000 }).then(() => true).catch(() => false);
ok("a contributed button appears in the Explorer context menu", sawButton);
if (sawButton) {
  const labels = await page.$$eval('[data-testid="explorerctx-contributed"]', (els) => els.map((e) => e.textContent.trim()));
  ok("the contributed buttons show [Star It, Danger Zone]", eq(labels, ["Star It", "Danger Zone"]), JSON.stringify(labels));
  // click the first contributed button → its onClick fires + menu closes
  await page.click('[data-testid="explorerctx-contributed"]');
  const firedUI = await app(() => window.__fired);
  ok("clicking the contributed item runs its onClick", firedUI === "star:fmtarget.md", JSON.stringify(firedUI));
  const menuGone = await page.$('[data-testid="explorer-menu"]').then((el) => el === null);
  ok("the menu closes after clicking a contributed item", menuGone);
}

console.log(`\nR130 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
