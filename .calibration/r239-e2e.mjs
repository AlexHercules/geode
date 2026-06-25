/**
 * R239 bookmarks:bookmark-search E2E — browser mode :1420.
 * Run: node .calibration/r239-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 239 additions".
 *
 * Completes search bookmarks: a command to CREATE one from the current search query
 * (SearchPanel mirrors its query into workspace.currentSearchQuery; the command reads + adds)
 * + fixes the click handler to RESTORE the search (workspace.requestSearch injects the query).
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
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.__geodeBookmarks, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r239", name: "r239", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const searchBookmarkQueries = () => app(() => {
  const walk = (items) => (items || []).flatMap((it) => (it.type === "group" ? walk(it.items) : it.type === "search" ? [it.query] : []));
  return walk(window.__geodeBookmarks.list());
});

console.log("— bookmarks:bookmark-search is registered with the native name —");
ok("command registered", await app(() => window.geode.app.commands.list().some((c) => c.id === "bookmarks:bookmark-search")));
ok("name is 'Bookmark current search'", await app(() => {
  const c = window.geode.app.commands.list().find((x) => x.id === "bookmarks:bookmark-search");
  const n = typeof c.name === "function" ? c.name() : c.name;
  return n === "Bookmark current search";
}));

console.log("— typing a search then running the command creates a search bookmark —");
await app(() => window.__app.workspace.setLeftPanel("search"));
await page.waitForSelector("[data-testid=search-input]", { timeout: 4000 });
await page.fill("[data-testid=search-input]", "needle42");
await wait(160); // query state → currentSearchQuery sync effect
ok("no search bookmark yet", !(await searchBookmarkQueries()).includes("needle42"));
await app(() => window.geode.app.commands.execute("bookmarks:bookmark-search"));
await wait(120);
ok("a search bookmark for the query was created", (await searchBookmarkQueries()).includes("needle42"), JSON.stringify(await searchBookmarkQueries()));

console.log("— running it again with an empty search is a no-op (no stray bookmark) —");
await app(() => window.__app.workspace.setLeftPanel("search"));
await page.waitForSelector("[data-testid=search-input]", { timeout: 4000 });
await page.fill("[data-testid=search-input]", "");
await wait(140);
const before = (await searchBookmarkQueries()).length;
await app(() => window.geode.app.commands.execute("bookmarks:bookmark-search"));
await wait(120);
ok("empty search adds no bookmark", (await searchBookmarkQueries()).length === before, `before=${before} after=${(await searchBookmarkQueries()).length}`);

console.log("— clicking the search bookmark restores the search (query injected) —");
await app(() => window.__app.workspace.setLeftPanel("bookmarks"));
await page.waitForSelector("[data-testid=bookmark-item]", { timeout: 4000 });
// there is exactly one bookmark (the search one) in this fresh memory vault
await page.click("[data-testid=bookmark-item]");
await wait(160);
ok("clicking opens the search panel", await app(() => !!document.querySelector("[data-testid=search-panel]")));
ok("the bookmarked query is injected into the search input", (await app(() => document.querySelector("[data-testid=search-input]")?.value)) === "needle42");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR239 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
