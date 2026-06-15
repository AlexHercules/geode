/**
 * R80 search toolbar E2E — sort / collapse / more-context / copy — browser :1420.
 * Run: node .calibration/r80-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 80 additions" (㊸).
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
await page.evaluate(() => {
  window.geode.registerPlugin({ id: "r80", name: "r80", onload(app) { window.__app = app; } });
  window.__clip = [];
  navigator.clipboard.writeText = (t) => { window.__clip.push(t); return Promise.resolve(); };
});
await page.waitForFunction(() => !!window.__app && !!window.__geodeSearchSort, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sort = (items, key) => app(([i, k]) => window.__geodeSearchSort(i, k), [items, key]);
const names = () => app(() => Array.from(document.querySelectorAll('[data-testid="search-result"] .search-file-name')).map((e) => e.textContent));
const lineCount = () => app(() => document.querySelectorAll('.search-line').length);

// ── sortResults truth table (probe hook) ────────────────────────────────────
console.log("— sortResults —");
const items = [
  { basename: "ant", nameMatch: false, total: 1 },
  { basename: "bee", nameMatch: false, total: 3 },
  { basename: "cat", nameMatch: false, total: 2 },
];
ok("name-asc → ant,bee,cat", JSON.stringify(await sort(items, "name-asc")) === '["ant","bee","cat"]');
ok("name-desc → cat,bee,ant", JSON.stringify(await sort(items, "name-desc")) === '["cat","bee","ant"]');
ok("count-desc → bee,cat,ant", JSON.stringify(await sort(items, "count-desc")) === '["bee","cat","ant"]');
ok("count-asc → ant,cat,bee", JSON.stringify(await sort(items, "count-asc")) === '["ant","cat","bee"]');
ok("relevance (no nameMatch) → bee,cat,ant (total desc)", JSON.stringify(await sort(items, "relevance")) === '["bee","cat","ant"]');

// ── open search panel + results ─────────────────────────────────────────────
console.log("— search panel + sort dropdown —");
await create("ant.md", "needle\n");
await create("bee.md", "needle needle needle\n");
await create("cat.md", "needle needle\n");
await wait(200);
await app(() => {
  window.__app.workspace.setLeftPanel("search");
  window.__app.workspace.searchRequest.set("needle");
});
await wait(600);
ok("toolbar appears with results", await app(() => !!document.querySelector('[data-testid="search-toolbar"]')));
ok("default (relevance) order: bee,cat,ant", JSON.stringify(await names()) === '["bee","cat","ant"]', JSON.stringify(await names()));
await page.selectOption('[data-testid="search-sort"]', "name-asc");
await wait(150);
ok("sort=name-asc → ant,bee,cat", JSON.stringify(await names()) === '["ant","bee","cat"]', JSON.stringify(await names()));
ok("sort persisted to localStorage", (await app(() => localStorage.getItem("geode.searchSort"))) === "name-asc");

// ── collapse all / expand all ───────────────────────────────────────────────
console.log("— collapse —");
const linesBefore = await lineCount();
ok("lines visible before collapse", linesBefore >= 3);
await page.locator('[data-testid="search-collapse-toggle"]').click();
await wait(150);
ok("collapse all → 0 visible lines", (await lineCount()) === 0);
await page.locator('[data-testid="search-collapse-toggle"]').click();
await wait(150);
ok("expand all → lines back", (await lineCount()) === linesBefore);
// per-file chevron collapses just that file
await page.locator('[data-testid="search-file-chevron"]').first().click();
await wait(120);
ok("per-file chevron collapses one file (fewer lines)", (await lineCount()) < linesBefore);
await page.locator('[data-testid="search-file-chevron"]').first().click();
await wait(120);

// ── copy results ────────────────────────────────────────────────────────────
console.log("— copy —");
await app(() => { window.__clip.length = 0; });
await page.locator('[data-testid="search-copy"]').click();
await wait(120);
ok("copy → clipboard has [[file]] list", (await app(() => window.__clip[window.__clip.length - 1])) === "- [[ant]]\n- [[bee]]\n- [[cat]]", await app(() => window.__clip[window.__clip.length - 1]));
ok("copy button shows 'Copied' feedback", (await app(() => document.querySelector('[data-testid="search-copy"]')?.getAttribute("title"))) === "Copied");

// ── more context (long line) ────────────────────────────────────────────────
console.log("— more context —");
await create("longline.md", "x".repeat(60) + " needlexyz789 " + "y".repeat(60) + "\n");
await wait(200);
await app(() => window.__app.workspace.searchRequest.set("needlexyz789"));
await wait(600);
const compact = await app(() => document.querySelector('.search-line')?.textContent?.length ?? 0);
await page.locator('[data-testid="search-context-toggle"]').click();
await wait(150);
const expanded = await app(() => document.querySelector('.search-line')?.textContent?.length ?? 0);
ok("show-more-context → line text gets longer (full line)", expanded > compact, `compact=${compact} expanded=${expanded}`);
ok("more-context persisted", (await app(() => localStorage.getItem("geode.searchContext"))) === "1");

console.log(`\nR80 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
