/**
 * R143 search "Match case" global toggle E2E — browser mode :1420.
 * Run: node .calibration/r143-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 143 additions".
 *
 * Obsidian's global search has a "Match case" toggle (Aa), default OFF. R143 wires it: the toggle
 * flips how `default`-mode terms are interpreted (insensitive ↔ sensitive); explicit match-case:/
 * ignore-case: operators always win; regex terms keep their own /i-flag semantics (toggle-independent).
 * Core layer is tested via __geodeSearchQuery(query, input, defaultCaseSensitive); UI via the Aa button.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r143", name: "r143", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeSearchQuery, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// core probe: parseSearchQuery → evaluateSearch with the global match-case flag
const m = (query, input, sensitive = false) =>
  page.evaluate(([q, i, s]) => window.__geodeSearchQuery(q, i, s), [query, input, sensitive]);

console.log("— core: a default-mode term follows the global Match-case flag —");
ok("'Hello' matches 'hello world' when flag OFF (insensitive default)", await m("Hello", { content: "hello world" }, false));
ok("'Hello' does NOT match 'hello world' when flag ON (sensitive)", !(await m("Hello", { content: "hello world" }, true)));
ok("'hello' matches 'hello world' regardless of flag (ON)", await m("hello", { content: "hello world" }, true));

console.log("— core: explicit match-case:/ignore-case: operators always WIN over the global flag —");
ok("match-case:Hello never matches 'hello' even with flag OFF", !(await m("match-case:Hello", { content: "hello" }, false)));
ok("ignore-case:Hello matches 'hello' even with flag ON", await m("ignore-case:Hello", { content: "hello" }, true));

console.log("— core: the flag applies to default content, file-name, tag and property terms —");
ok("basename: 'Note' matches basename 'note' when flag OFF", await m("Note", { basename: "note", content: "" }, false));
ok("basename: 'Note' does NOT match basename 'note' when flag ON", !(await m("Note", { basename: "note", content: "" }, true)));
ok("tag: 'tag:work' matches tag 'Work' when flag OFF", await m("tag:work", { tags: ["Work"] }, false));
ok("tag: 'tag:work' does NOT match tag 'Work' when flag ON", !(await m("tag:work", { tags: ["Work"] }, true)));
ok("property: '[Status:done]' matches Status=Done when flag OFF", await m("[Status:done]", { frontmatter: { Status: "Done" } }, false));
ok("property: '[Status:done]' does NOT match Status=Done when flag ON", !(await m("[Status:done]", { frontmatter: { Status: "Done" } }, true)));

console.log("— core: regex terms keep their own /i-flag semantics, UNAFFECTED by the global flag —");
ok("/Hello/ never matches 'hello' (no i-flag = case-sensitive), flag OFF", !(await m("/Hello/", { content: "hello" }, false)));
ok("/Hello/ never matches 'hello', flag ON too (regex toggle-independent)", !(await m("/Hello/", { content: "hello" }, true)));
ok("/hello/i matches 'HELLO' (explicit i-flag), flag ON", await m("/hello/i", { content: "HELLO" }, true));

console.log("— UI: the Aa toggle re-scans and changes results; pref persists —");
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
// two notes: only one matches "Qzzx" case-sensitively
await create("r143upper.md", "QzzxToken here\n");
await create("r143lower.md", "qzzxtoken here\n");
await wait(200);
// make sure the toggle starts OFF (clean pref)
await app(() => localStorage.removeItem("geode.searchCase"));
await app(() => { window.__app.workspace.setLeftPanel("search"); window.__app.workspace.searchRequest.set("Qzzx"); });
await wait(700);
const resultCount = () => app(() => document.querySelectorAll('[data-testid="search-result"]').length);
ok("the Aa toggle is present in the search bar", await app(() => !!document.querySelector('[data-testid="search-case-toggle"]')));
ok("Aa starts inactive (default OFF)", await app(() => !document.querySelector('[data-testid="search-case-toggle"]').classList.contains("is-active")));
const insensitiveCount = await resultCount();
ok("flag OFF: both r143upper + r143lower match 'Qzzx' (insensitive)", insensitiveCount === 2, `count=${insensitiveCount}`);

await page.click('[data-testid="search-case-toggle"]');
await wait(500);
ok("Aa is now active after click", await app(() => document.querySelector('[data-testid="search-case-toggle"]').classList.contains("is-active")));
ok("Aa is aria-pressed when active", await app(() => document.querySelector('[data-testid="search-case-toggle"]').getAttribute("aria-pressed") === "true"));
const sensitiveCount = await resultCount();
ok("flag ON: only r143upper matches 'Qzzx' (sensitive → re-scanned)", sensitiveCount === 1, `count=${sensitiveCount}`);
ok("the match-case pref is persisted to localStorage", (await app(() => localStorage.getItem("geode.searchCase"))) === "1");

console.log("— UI: the persisted Match-case pref survives a reload —");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r143b", name: "r143b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await app(() => window.__app.workspace.setLeftPanel("search"));
await page.waitForSelector('[data-testid="search-case-toggle"]', { timeout: 3000 });
ok("after reload, Aa is still active (pref persisted)", await app(() => document.querySelector('[data-testid="search-case-toggle"]').classList.contains("is-active")));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR143 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
