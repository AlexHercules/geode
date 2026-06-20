/**
 * R139 compat workspace.on('files-menu') (multi-file right-click menu) E2E — browser mode :1420.
 * Run: node .calibration/r139-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 139 additions".
 *
 * Obsidian fires 'files-menu' with a TAbstractFile[] when you right-click a multi-selection in the
 * file explorer; plugins add bulk items. Mirrors R130's file-menu: a compat provider builds a
 * CollectorMenu + fires the event; the Explorer calls collectFilesMenu([...selection]) when
 * right-clicking inside a >1 selection, showing the contributed items under a "{count} selected"
 * header (falls back to the single-file menu when no plugin contributes).
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const eq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r139", name: "r139", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace && !!window.app._geode && !!window.app._geode.plugins, null, { timeout: 5000 });

await page.evaluate(async () => { for (const n of ["m-a", "m-b", "m-c"]) { try { await window.__app.vault.create(n + ".md", "# " + n + "\n"); } catch { /* exists */ } } });
const row = (p) => `[data-testid="explorer-item"][data-path="${p}.md"]`;
await page.waitForSelector(row("m-a"), { timeout: 5000 });
const clearSel = () => page.locator(".explorer-tree").press("Escape");
const multiSelect = async (...names) => { for (const n of names) await page.click(row(n), { modifiers: ["ControlOrMeta"] }); };

console.log("— fallback: right-click a multi-selection with NO files-menu handler → single-file menu —");
await clearSel();
await multiSelect("m-a", "m-b");
await page.click(row("m-a"), { button: "right" });
await page.waitForSelector('[data-testid="explorer-menu"]', { timeout: 3000 });
ok("no files-menu items → falls back to single-file menu (Rename present)", await page.evaluate(() => !!document.querySelector('[data-testid="explorerctx-rename"]')));
ok("no multi-file header in the fallback menu", await page.evaluate(() => !document.querySelector('[data-testid="explorerctx-files-count"]')));
await page.keyboard.press("Escape");

console.log("— register on('files-menu') + the data path (collectFilesMenu fires the event) —");
await page.evaluate(() => {
  window.__fm = null; window.__fmClicked = null;
  window.app.workspace.on("files-menu", (menu, files, source) => {
    window.__fm = { src: source, paths: files.map((f) => f.path) };
    menu.addItem((i) => i.setTitle("Bulk Tag").setIcon("tag").onClick(() => { window.__fmClicked = files.map((f) => f.path); }));
  });
});
const collected = await page.evaluate(() => {
  const items = window.app._geode.plugins.collectFilesMenu({ paths: ["m-a.md", "m-b.md"], source: "file-explorer-context-menu" });
  const r = { titles: items.map((i) => i.title), icons: items.map((i) => i.icon ?? null), fm: window.__fm };
  items[0].onClick();
  r.clicked = window.__fmClicked;
  return r;
});
ok("collectFilesMenu returns the contributed item [Bulk Tag]", eq(collected.titles, ["Bulk Tag"]), JSON.stringify(collected.titles));
ok("icon captured (tag)", eq(collected.icons, ["tag"]), JSON.stringify(collected.icons));
ok("the handler received source = 'file-explorer-context-menu'", collected.fm?.src === "file-explorer-context-menu", JSON.stringify(collected.fm));
ok("the handler received the TFile[] paths [m-a, m-b]", eq(collected.fm?.paths, ["m-a.md", "m-b.md"]), JSON.stringify(collected.fm?.paths));
ok("the item's onClick closure fires with the captured files", eq(collected.clicked, ["m-a.md", "m-b.md"]), JSON.stringify(collected.clicked));

console.log("— no resolvable path → [] (never throws) —");
const empty = await page.evaluate(() => {
  let threw = false, res = null;
  try { res = window.app._geode.plugins.collectFilesMenu({ paths: ["ghost9999.md"], source: "x" }); } catch { threw = true; }
  return { threw, len: res ? res.length : -1 };
});
ok("unresolvable paths → [] (provider resolves zero files, no trigger), no throw", empty.threw === false && empty.len === 0, JSON.stringify(empty));

console.log("— the Explorer UI: right-click INSIDE a multi-selection → the multi-file menu —");
await clearSel();
await multiSelect("m-a", "m-b");
await page.evaluate(() => { window.__fmClicked = null; });
await page.click(row("m-a"), { button: "right" });
await page.waitForSelector('[data-testid="explorer-menu"]', { timeout: 3000 });
ok("the multi-file menu shows the '{count} selected' header (2)", (await page.evaluate(() => document.querySelector('[data-testid="explorerctx-files-count"]')?.textContent ?? "")).includes("2"));
ok("the multi-file menu shows the contributed 'Bulk Tag' item", await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="explorerctx-contributed"]')).some((b) => b.textContent.includes("Bulk Tag"))));
ok("the multi-file menu does NOT show single-file built-ins (no Rename)", await page.evaluate(() => !document.querySelector('[data-testid="explorerctx-rename"]')));
await page.click('[data-testid="explorerctx-contributed"]');
ok("clicking the contributed item fires onClick with all selected files", eq(await page.evaluate(() => window.__fmClicked), ["m-a.md", "m-b.md"]), JSON.stringify(await page.evaluate(() => window.__fmClicked)));

console.log("— right-click OUTSIDE the selection collapses to a single-file menu —");
await clearSel();
await multiSelect("m-a", "m-b");
await page.click(row("m-c"), { button: "right" }); // m-c not in {m-a,m-b}
await page.waitForSelector('[data-testid="explorer-menu"]', { timeout: 3000 });
ok("right-click outside → single-file menu (Rename present, no files header)", await page.evaluate(() => !!document.querySelector('[data-testid="explorerctx-rename"]') && !document.querySelector('[data-testid="explorerctx-files-count"]')));
await page.keyboard.press("Escape");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR139 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
