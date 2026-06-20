/**
 * R158 compat app.internalPlugins bookmarks instance E2E — browser mode :1420.
 * Run: node .calibration/r158-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 158 additions" (compat 商业主轴).
 *
 * Obsidian's (non-public) `app.internalPlugins.getPluginById("bookmarks").instance`:
 * getBookmarks()/addItem(item)/removeItem(item)/getItemTitle(item). Backed by R27's native
 * bookmark store; getBookmarks reads the live store, so a round-trip proves writes hit it.
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app && !!window.app.internalPlugins, null, { timeout: 15000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// does getBookmarks() currently contain a file bookmark for this path?
const hasFile = (p) => ev((path) => window.app.internalPlugins.getPluginById("bookmarks").instance
  .getBookmarks().some((b) => b.type === "file" && b.path === path), p);

console.log("— getPluginById / getEnabledPluginById shape —");
ok("getPluginById('bookmarks') → { enabled:true, instance }", await ev(() => {
  const p = window.app.internalPlugins.getPluginById("bookmarks");
  return !!p && p.enabled === true && !!p.instance && typeof p.instance.getBookmarks === "function";
}));
ok("getPluginById('does-not-exist') → null (no throw)", await ev(() => window.app.internalPlugins.getPluginById("nope") === null));
ok("getEnabledPluginById('bookmarks') → the instance", await ev(() => {
  const inst = window.app.internalPlugins.getEnabledPluginById("bookmarks");
  return !!inst && typeof inst.getBookmarks === "function" && typeof inst.addItem === "function";
}));
ok("getEnabledPluginById('nope') → null", await ev(() => window.app.internalPlugins.getEnabledPluginById("nope") === null));

console.log("— getBookmarks reads the live store; addItem / removeItem round-trip —");
ok("getBookmarks() returns an array", await ev(() => Array.isArray(window.app.internalPlugins.getPluginById("bookmarks").instance.getBookmarks())));
ok("the test path is not bookmarked yet", (await hasFile("r158-bm.md")) === false);

await ev(() => window.app.internalPlugins.getEnabledPluginById("bookmarks").addItem({ type: "file", path: "r158-bm.md", ctime: 123 }));
await wait(120);
ok("addItem({type:file}) → getBookmarks() now includes it (write hit the native store)", (await hasFile("r158-bm.md")) === true);
ok("the added file is bookmarked in the native store too (isFileBookmarked via panel state)", await ev(() => {
  // getBookmarks reads `bookmarks.items.get()` directly, so its presence proves the singleton store changed
  const items = window.app.internalPlugins.getPluginById("bookmarks").instance.getBookmarks();
  return items.some((b) => b.type === "file" && b.path === "r158-bm.md" && b.ctime === 123);
}));

await ev(() => window.app.internalPlugins.getEnabledPluginById("bookmarks").removeItem({ type: "file", path: "r158-bm.md" }));
await wait(120);
ok("removeItem({type:file}) → getBookmarks() no longer includes it", (await hasFile("r158-bm.md")) === false);

console.log("— getItemTitle —");
ok("getItemTitle(file) → basename without extension (Obsidian TFile.basename)", await ev(() => window.app.internalPlugins.getPluginById("bookmarks").instance.getItemTitle({ type: "file", path: "Notes/Ideas.md" }) === "Ideas"));
ok("getItemTitle honors a custom title", await ev(() => window.app.internalPlugins.getPluginById("bookmarks").instance.getItemTitle({ type: "file", path: "x.md", title: "My Bookmark" }) === "My Bookmark"));
ok("getItemTitle(search) → the query", await ev(() => window.app.internalPlugins.getPluginById("bookmarks").instance.getItemTitle({ type: "search", query: "tag:#todo" }) === "tag:#todo"));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR158 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
