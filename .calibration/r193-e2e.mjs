/**
 * R193 — G3 missing→done: bookmarks:unbookmark / bookmarks:bookmark-all-tabs
 * (Obsidian bookmark commands) — browser :1420.
 * Run: node .calibration/r193-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 193 additions".
 *
 * Reuses the vetted bookmark store (isFileBookmarked/toggleFile/add). unbookmark is a
 * dedicated REMOVE gated on isFileBookmarked; bookmark-all-tabs adds every open file-backed
 * tab (idempotent). Verified via the compat store (getBookmarks) + command availability.
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
await page.evaluate(() => {
  localStorage.setItem("geode.locale", "en");
  localStorage.removeItem("geode.workspace.v1");
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r193", name: "r193", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.internalPlugins, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (id) => app(([cid]) => window.__app.commands.execute(cid), [id]);
const availOf = (id) => app(([cid]) => {
  const c = window.__app.commands.list().find((x) => x.id === cid);
  return c && c.available ? c.available() : true;
}, [id]);
const bookmarkedFiles = () => app(() => {
  const walk = (items) => (items || []).flatMap((it) => (it.type === "group" ? walk(it.items) : it.type === "file" ? [it.path] : []));
  return walk(window.app.internalPlugins.getPluginById("bookmarks").instance.getBookmarks());
});

const IDS = ["bookmarks:unbookmark", "bookmarks:bookmark-all-tabs"];
console.log("— both commands registered + names resolve + no default hotkey —");
const reg = await app(([ids]) => ids.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null, hk: window.__app.commands.getEffectiveHotkey(id) || null };
}), [IDS]);
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("cmd."), r.name);
  ok(`${r.id} has no default hotkey`, r.hk === null, r.hk);
}

console.log("— unbookmark: gated on isFileBookmarked, removes when present —");
await app(() => window.__app.workspace.openFile("Welcome.md"));
await wait(120);
ok("unbookmark unavailable when active file not bookmarked", (await availOf("bookmarks:unbookmark")) === false);
await exec("bookmarks:bookmark-file"); // bookmark Welcome.md via the existing toggle
await wait(120);
ok("Welcome.md is now bookmarked", (await bookmarkedFiles()).includes("Welcome.md"));
ok("unbookmark available once bookmarked", (await availOf("bookmarks:unbookmark")) === true);
await exec("bookmarks:unbookmark");
await wait(120);
ok("unbookmark removed Welcome.md from the store", !(await bookmarkedFiles()).includes("Welcome.md"));
ok("unbookmark unavailable again after removal", (await availOf("bookmarks:unbookmark")) === false);

console.log("— unbookmark never ADDS (no-op when not bookmarked) —");
const before = await bookmarkedFiles();
await exec("bookmarks:unbookmark"); // not bookmarked → guarded no-op
await wait(80);
ok("unbookmark on a non-bookmarked file does not add it", JSON.stringify(await bookmarkedFiles()) === JSON.stringify(before));

console.log("— bookmark-all-tabs: bookmarks every open file-backed tab —");
await app(async () => { for (const f of ["bm1.md", "bm2.md"]) { try { await window.__app.vault.create(f, "# " + f + "\n"); } catch { /* exists */ } } });
await app(() => {
  window.__app.workspace.openFile("bm1.md", { newTab: true });
  window.__app.workspace.openFile("bm2.md", { newTab: true });
});
await wait(150);
await exec("bookmarks:bookmark-all-tabs");
await wait(200);
let marked = await bookmarkedFiles();
ok("bookmark-all-tabs bookmarked bm1.md", marked.includes("bm1.md"), JSON.stringify(marked));
ok("bookmark-all-tabs bookmarked bm2.md", marked.includes("bm2.md"), JSON.stringify(marked));
ok("bookmark-all-tabs bookmarked the open Welcome.md too", marked.includes("Welcome.md"), JSON.stringify(marked));

console.log("— bookmark-all-tabs is idempotent (no duplicates on re-run) —");
const countBefore = (await bookmarkedFiles()).length;
await exec("bookmarks:bookmark-all-tabs");
await wait(200);
const countAfter = (await bookmarkedFiles()).length;
ok("re-running bookmark-all-tabs adds no duplicates", countAfter === countBefore, `${countBefore} → ${countAfter}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR193: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
