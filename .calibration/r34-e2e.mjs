/**
 * R34 in-editor find/replace (Cmd-F) E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r34-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 34 additions".
 *
 * Covers:
 *  A. probe (window.__geodeSearch): open()/isOpen()/replaceAll()/close() against
 *     the active view's CM6 @codemirror/search panel. replaceAll rewrites the doc
 *     (all matches), the change lands in the document model AND — past the autosave
 *     debounce — persists to the vault (data-safety). close() returns false.
 *  B. live panel in a REAL CM editor + keyboard: Meta+F (editor:search command)
 *     opens .cm-search; the replace row + a localized "replace all" label are
 *     present; typing a query into the find field highlights matches
 *     (.cm-searchMatch); Escape closes the panel.
 *     Command registration: editor:search and editor:replace are registered.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r34", name: "r34", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeSearch, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// open a file in live mode and focus its CM editor.
const openLive = (path) => app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, path);

// ── A. probe (window.__geodeSearch) ──────────────────────────────────────────
console.log("A. probe (window.__geodeSearch)");

await create("r34/scratch.md", "alpha foo beta\nfoo gamma foo\n");
await openLive("r34/scratch.md");
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");

ok("__geodeSearch.open() returns true", (await app(() => window.__geodeSearch.open())) === true);
ok("__geodeSearch.isOpen() true after open", (await app(() => window.__geodeSearch.isOpen())) === true);

const replaced = await app(() => window.__geodeSearch.replaceAll("foo", "XYZ"));
ok("replaceAll returns a string", typeof replaced === "string", JSON.stringify(replaced));
ok("replaceAll replaced all 3 'foo' → 'XYZ'",
  replaced === "alpha XYZ beta\nXYZ gamma XYZ\n", JSON.stringify(replaced));

const docText = await app(() => window.__app.documents.get("r34/scratch.md")?.getText() ?? "");
ok("document model reflects the replacement",
  docText === "alpha XYZ beta\nXYZ gamma XYZ\n", JSON.stringify(docText));

// data-safety: past the autosave debounce, the replacement must persist to the vault
await wait(1500);
const onDisk = await app(() => window.__app.vault.read("r34/scratch.md"));
ok("replacement persisted to vault (autosave)",
  onDisk === "alpha XYZ beta\nXYZ gamma XYZ\n", JSON.stringify(onDisk));

ok("__geodeSearch.close() returns false (panel closed)", (await app(() => window.__geodeSearch.close())) === false);
ok("__geodeSearch.isOpen() false after close", (await app(() => window.__geodeSearch.isOpen())) === false);

// ── B. live panel (real CM + keyboard) ───────────────────────────────────────
console.log("B. live panel (real CM editor + keyboard)");

// reset a file with fresh content (vault.modify if it already exists)
await app(async () => {
  const body = "needle in haystack needle\n";
  await window.__app.vault.create("r34/live.md", body).catch(() =>
    window.__app.vault.modify("r34/live.md", body).catch(() => {}));
  await new Promise((r) => setTimeout(r, 40));
});
await openLive("r34/live.md");
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");

await page.keyboard.press("Meta+F");
await wait(150);
ok("Meta+F opens the CM search panel (.cm-search visible)", await page.isVisible(".cm-search"));
ok("panel shows the replace row ([name=replace] visible)", await page.isVisible(".cm-search [name=replace]"));

const panelTxt = (await page.textContent(".cm-search").catch(() => "")) ?? "";
ok("panel includes a localized 'replace' label",
  panelTxt.toLowerCase().includes("replace"), JSON.stringify(panelTxt));

// type a query into the find field → matches should highlight. Use REAL
// keystrokes (not page.fill): CM's find field commits the query on keyup, which
// page.fill does not fire — so highlights only appear when keys are truly typed.
await page.click(".cm-search [name=search]");
await page.keyboard.type("needle", { delay: 30 });
await wait(200);
let matchCount = (await page.$$(".cm-searchMatch")).length;
if (matchCount === 0) matchCount = (await page.$$(".cm-searchMatch-selected")).length;
ok("typing a query highlights matches (.cm-searchMatch >= 1)",
  matchCount >= 1, `matches=${matchCount}`);

await page.keyboard.press("Escape");
await wait(150);
ok("Escape closes the search panel (.cm-search not visible)", !(await page.isVisible(".cm-search")));

// command registration: editor:search + editor:replace (defensive command-list lookup)
{
  const reg = await app(() => {
    const cmds = window.__app.commands;
    const list = (cmds.list?.() ?? cmds.getAll?.() ?? cmds.all?.() ?? []);
    const ids = Array.isArray(list)
      ? list.map((c) => (typeof c === "string" ? c : c.id))
      : Object.keys(list);
    const has = (id) => ids.includes(id);
    return {
      hasSearch: has("editor:search"),
      hasReplace: has("editor:replace"),
    };
  });
  ok("editor:search command registered", reg.hasSearch, JSON.stringify(reg));
  ok("editor:replace command registered", reg.hasReplace, JSON.stringify(reg));
}

console.log(`\nR34 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exitCode = 1; }
await browser.close();
process.exit(failed ? 1 : 0);
