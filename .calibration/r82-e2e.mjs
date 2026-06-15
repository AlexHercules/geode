/**
 * R82 Backlinks / Outgoing panel enhancement E2E — browser mode :1420.
 * Run: node .calibration/r82-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 82 additions" (㊷).
 *
 * Covers ㊷ panel toolbars: sortAndFilterLinks truth table (probe hook) +
 * backlinks linked-mentions sort/filter/collapse-all/per-source toggle +
 * outgoing sort/filter. View-only (no .md writes besides create-on-click, untouched).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r82", name: "r82", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeLinkSortFilter, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const openFile = (p) => app(async (path) => {
  window.__app.workspace.openFile(path);
  await new Promise((r) => setTimeout(r, 200));
}, p);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sf = (items, key, filter) => app(([i, k, f]) => window.__geodeLinkSortFilter(i, k, f), [items, key, filter]);

// ── sortAndFilterLinks truth table (probe hook) ─────────────────────────────
console.log("— sortAndFilterLinks —");
const rows = [{ name: "Charlie" }, { name: "alpha" }, { name: "Bravo" }];
ok("default → original order", JSON.stringify(await sf(rows, "default", "")) === '["Charlie","alpha","Bravo"]');
ok("name-asc → locale A→Z", JSON.stringify(await sf(rows, "name-asc", "")) === '["alpha","Bravo","Charlie"]');
ok("name-desc → locale Z→A", JSON.stringify(await sf(rows, "name-desc", "")) === '["Charlie","Bravo","alpha"]');
ok("filter is case-insensitive substring", JSON.stringify(await sf(rows, "default", "RaV")) === '["Bravo"]');
ok("filter + sort compose", JSON.stringify(await sf(rows, "name-asc", "a")) === '["alpha","Bravo","Charlie"]');
ok("empty filter keeps all", (await sf(rows, "default", "   ")).length === 3);
ok("no match → empty", (await sf(rows, "default", "zzz")).length === 0);

// ── backlinks panel ─────────────────────────────────────────────────────────
console.log("— backlinks toolbar —");
await create("Target.md", "# Target\n");
await create("Zeb.md", "see [[Target]] here and [[Target]] again\n");
await create("Ada.md", "ref [[Target]]\n");
await create("Mid.md", "mentions [[Target]] once\n");
await wait(200);
await openFile("Target.md");
await page.click('[data-testid="right-tab-backlinks"]');
await page.waitForSelector('[data-testid="backlinks-panel"]', { timeout: 4000 }).catch(() => {});
ok("backlinks panel shows", (await app(() => !!document.querySelector('[data-testid="backlinks-panel"]'))));
ok("linked-mentions toolbar present", (await app(() => !!document.querySelector('[data-testid="bl-toolbar"]'))));

const sourceNames = () => app(() =>
  [...document.querySelectorAll('[data-testid="backlinks-panel"] [data-testid="bl-section-mentions"] ~ * [data-testid="bl-source"], [data-testid="backlinks-panel"] [data-testid="bl-source"]')]
    .map((e) => e.querySelector(".bl-ellipsis")?.textContent ?? ""));
// 3 backlink sources (Zeb, Ada, Mid)
ok("three backlink sources", (await sourceNames()).filter((n) => ["Zeb", "Ada", "Mid"].includes(n)).length === 3, JSON.stringify(await sourceNames()));

// sort name-asc
await page.selectOption('[data-testid="bl-sort"]', "name-asc");
await wait(120);
let names = (await sourceNames()).filter((n) => ["Zeb", "Ada", "Mid"].includes(n));
ok("sort A→Z orders Ada, Mid, Zeb", JSON.stringify(names) === '["Ada","Mid","Zeb"]', JSON.stringify(names));
await page.selectOption('[data-testid="bl-sort"]', "name-desc");
await wait(120);
names = (await sourceNames()).filter((n) => ["Zeb", "Ada", "Mid"].includes(n));
ok("sort Z→A orders Zeb, Mid, Ada", JSON.stringify(names) === '["Zeb","Mid","Ada"]', JSON.stringify(names));

// filter
await page.fill('[data-testid="bl-filter"]', "ad");
await wait(150);
names = (await sourceNames()).filter((n) => ["Zeb", "Ada", "Mid"].includes(n));
ok("filter 'ad' narrows to Ada", JSON.stringify(names) === '["Ada"]', JSON.stringify(names));
await page.fill('[data-testid="bl-filter"]', "zzz");
await wait(120);
ok("filter no-match shows empty sub", (await app(() => {
  const sec = document.querySelector('[data-testid="bl-section-mentions"]')?.parentElement;
  return !!sec && /No mentions match/.test(sec.textContent || "");
})));
await page.fill('[data-testid="bl-filter"]', "");
await wait(120);

// per-source collapse: Zeb has 2 contexts
await page.selectOption('[data-testid="bl-sort"]', "name-desc");
await wait(120);
const ctxCount = () => app(() => document.querySelectorAll('[data-testid="backlinks-panel"] [data-testid="bl-snippet"]').length);
const before = await ctxCount();
ok("contexts visible before collapse", before >= 4, String(before)); // Zeb 2 + Ada 1 + Mid 1
// collapse all
await page.click('[data-testid="bl-collapse-toggle"]');
await wait(150);
ok("collapse-all hides all contexts", (await ctxCount()) === 0, String(await ctxCount()));
// expand all (button now toggles back)
await page.click('[data-testid="bl-collapse-toggle"]');
await wait(150);
ok("expand-all restores contexts", (await ctxCount()) >= 4, String(await ctxCount()));
// single source toggle
await page.click('[data-testid="bl-source-toggle"]');
await wait(150);
ok("toggling one source hides only its contexts", (await ctxCount()) < before && (await ctxCount()) > 0, String(await ctxCount()));

// ── outgoing panel ──────────────────────────────────────────────────────────
console.log("— outgoing toolbar —");
await create("Apple.md", "# Apple\n");
await create("Cherry.md", "# Cherry\n");
await create("Banana.md", "# Banana\n");
await create("OutSrc.md", "see [[Cherry]] and [[Apple]] and [[Banana]] and [[Ghosty]]\n");
await wait(200);
await openFile("OutSrc.md");
await page.click('[data-testid="right-tab-outgoinglinks"]');
await page.waitForSelector('[data-testid="outgoinglinks-panel"]', { timeout: 4000 }).catch(() => {});
ok("outgoing toolbar present", (await app(() => !!document.querySelector('[data-testid="ol-toolbar"]'))));

const resolvedNames = () => app(() =>
  [...document.querySelectorAll('[data-testid="ol-section-links"] ~ * [data-testid="ol-link"], [data-testid="outgoinglinks-panel"] [data-testid="ol-link"]')]
    .map((e) => e.querySelector(".ol-ellipsis")?.textContent ?? "")
    .filter((n) => ["Apple", "Cherry", "Banana"].includes(n)));
await page.selectOption('[data-testid="ol-sort"]', "name-asc");
await wait(120);
let onames = await resolvedNames();
ok("outgoing sort A→Z (Apple, Banana, Cherry)", JSON.stringify(onames) === '["Apple","Banana","Cherry"]', JSON.stringify(onames));
await page.selectOption('[data-testid="ol-sort"]', "name-desc");
await wait(120);
onames = await resolvedNames();
ok("outgoing sort Z→A (Cherry, Banana, Apple)", JSON.stringify(onames) === '["Cherry","Banana","Apple"]', JSON.stringify(onames));
await page.fill('[data-testid="ol-filter"]', "an");
await wait(150);
onames = await resolvedNames();
ok("outgoing filter 'an' → Banana", JSON.stringify(onames) === '["Banana"]', JSON.stringify(onames));
ok("filter also narrows unresolved (Ghosty hidden)", (await app(() =>
  ![...document.querySelectorAll('[data-testid="ol-link"]')].some((e) => /Ghosty/.test(e.textContent || "")))));

// ── cross-note state reset (reviewer MAJOR: stale filter → false-empty) ──────
console.log("— state resets on file switch —");
// Two notes, each with a distinct backlink source that won't match the other's filter.
await create("NoteX.md", "# NoteX\n");
await create("NoteY.md", "# NoteY\n");
await create("SrcForX.md", "ref [[NoteX]]\n");
await create("SrcForY.md", "ref [[NoteY]]\n");
await wait(200);
await openFile("NoteX.md");
await page.click('[data-testid="right-tab-backlinks"]');
await wait(150);
await page.fill('[data-testid="bl-filter"]', "SrcForX");
await page.selectOption('[data-testid="bl-sort"]', "name-desc");
await wait(150);
ok("filter applied on NoteX (SrcForX visible)", (await app(() =>
  [...document.querySelectorAll('[data-testid="bl-source"]')].some((e) => /SrcForX/.test(e.textContent || "")))));
// switch to NoteY — its real backlink is SrcForY, which the stale "SrcForX" filter would hide
await openFile("NoteY.md");
await wait(200);
ok("filter cleared on file switch", (await app(() => document.querySelector('[data-testid="bl-filter"]')?.value === "")));
ok("sort reset to default on file switch", (await app(() => document.querySelector('[data-testid="bl-sort"]')?.value === "default")));
ok("NoteY's real backlink (SrcForY) is visible, not false-empty", (await app(() =>
  [...document.querySelectorAll('[data-testid="bl-source"]')].some((e) => /SrcForY/.test(e.textContent || "")))));

console.log(`\nR82 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
