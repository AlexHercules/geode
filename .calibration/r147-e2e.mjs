/**
 * R147 compat MarkdownView.showSearch(replace?) E2E — browser mode :1420.
 * Run: node .calibration/r147-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 147 additions".
 *
 * Adds the confirmed-missing @public MarkdownView.showSearch(replace?) (obsidian.d.ts:4233). It
 * delegates to CM's openSearchPanel (the R34 editor-find mechanism) on the view's editor.cm;
 * replace=true focuses the replace field. Verified via the compat MarkdownView on
 * window.app.workspace.activeLeaf.view (what a real plugin reaches).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r147", name: "r147", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });

const app = (fn) => page.evaluate(fn);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// open a markdown file in edit mode + focus its CM editor (so getActiveView() is set → activeLeaf.view)
await app(async () => {
  try { await window.__app.vault.create("r147.md", "# r147 showSearch probe\nalpha beta gamma\n"); } catch { /* exists */ }
  await window.__app.workspace.openFile("r147.md");
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await page.waitForFunction(() => !!window.app.workspace.activeLeaf?.view, null, { timeout: 5000 });

console.log("— showSearch() opens the editor find panel —");
const shapes = await app(() => {
  const v = window.app.workspace.activeLeaf.view;
  return { isFn: typeof v.showSearch };
});
ok("activeLeaf.view.showSearch is a function", shapes.isFn === "function", JSON.stringify(shapes));
ok("the search panel is not open initially", !(await page.isVisible(".cm-search")));
await app(() => window.app.workspace.activeLeaf.view.showSearch());
await wait(80);
ok("showSearch() opens the CM search panel (.cm-search visible)", await page.isVisible(".cm-search"));
// close it (Escape, focused in the editor)
await page.click(".cm-content");
await page.keyboard.press("Escape");
await wait(80);
ok("the panel can be closed again (Escape)", !(await page.isVisible(".cm-search")));

console.log("— showSearch(true) opens the panel with the REPLACE field focused —");
await app(() => window.app.workspace.activeLeaf.view.showSearch(true));
await wait(120); // requestAnimationFrame focus
ok("showSearch(true) opens the panel", await page.isVisible(".cm-search"));
ok("the replace field exists ([name=replace])", await page.isVisible('.cm-search [name="replace"]'));
const focusedIsReplace = await app(() => {
  const a = document.activeElement;
  return !!a && a.getAttribute("name") === "replace" && a.closest(".cm-search") !== null;
});
ok("showSearch(true) focuses the replace input", focusedIsReplace === true);

console.log("— showSearch(false) opens find WITHOUT focusing replace —");
await page.click(".cm-content");
await page.keyboard.press("Escape");
await wait(60);
await app(() => window.app.workspace.activeLeaf.view.showSearch(false));
await wait(120);
ok("showSearch(false) opens the panel", await page.isVisible(".cm-search"));
const findFocusedNotReplace = await app(() => document.activeElement?.getAttribute("name") !== "replace");
ok("showSearch(false) does NOT focus the replace field", findFocusedNotReplace === true);

console.log("— re-entry: showSearch(true) while the panel is ALREADY open keeps it open + focuses replace —");
// review nit: openSearchPanel is open-only (not a toggle) — a second call must NOT close the panel.
ok("panel is still open from the previous showSearch(false)", await page.isVisible(".cm-search"));
await app(() => window.app.workspace.activeLeaf.view.showSearch(true)); // no Escape between calls
await wait(120);
ok("re-entrant showSearch(true) keeps the panel open (open-only, not a toggle)", await page.isVisible(".cm-search"));
const reentryReplaceFocused = await app(() => document.activeElement?.getAttribute("name") === "replace");
ok("re-entrant showSearch(true) focuses the replace field", reentryReplaceFocused === true);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR147 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
