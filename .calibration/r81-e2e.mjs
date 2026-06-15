/**
 * R81 tab context menu E2E — browser mode :1420.
 * Run: node .calibration/r81-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 81 additions" (㊿).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r81", name: "r81", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeTabsToClose, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const close = (tabs, target, mode) => app(([t, tg, m]) => window.__geodeTabsToClose(t, tg, m), [tabs, target, mode]);
const tabCount = () => app(() => document.querySelectorAll('[data-testid^="tab-bar-"] .tab').length);
const paneCount = () => app(() => document.querySelectorAll('[data-testid^="tab-bar-"]').length);

// ── tabIdsToClose truth table (probe hook) ──────────────────────────────────
console.log("— tabIdsToClose —");
const tabs = [{ id: "a" }, { id: "b", pinned: true }, { id: "c" }, { id: "d" }];
ok("others → a,d (skip target c + pinned b)", JSON.stringify(await close(tabs, "c", "others")) === '["a","d"]');
ok("right → d (after c, skip pinned)", JSON.stringify(await close(tabs, "c", "right")) === '["d"]');
ok("all → a,c,d (skip pinned b)", JSON.stringify(await close(tabs, "c", "all")) === '["a","c","d"]');
ok("right of a → c,d (b pinned skipped)", JSON.stringify(await close(tabs, "a", "right")) === '["c","d"]');

// ── open several tabs ───────────────────────────────────────────────────────
console.log("— context menu: close others —");
await create("t1.md", "one\n");
await create("t2.md", "two\n");
await create("t3.md", "three\n");
await wait(150);
await app(async () => {
  window.__app.workspace.openFile("t1.md", { newTab: true });
  window.__app.workspace.openFile("t2.md", { newTab: true });
  window.__app.workspace.openFile("t3.md", { newTab: true });
  await new Promise((r) => setTimeout(r, 250));
});
const before = await tabCount();
ok("multiple tabs open", before >= 3, String(before));
// right-click the last tab → menu → close others
await page.locator('[data-testid^="tab-bar-"] .tab').last().click({ button: "right" });
await wait(120);
ok("right-click opens the tab context menu", await app(() => !!document.querySelector('[data-testid="tab-context-menu"]')));
await page.locator('[data-testid="tabctx-close-others"]').click();
await wait(150);
ok("close others → exactly 1 tab remains", (await tabCount()) === 1, String(await tabCount()));
ok("the kept tab is t3 (the right-clicked one)", await app(() => window.__app.workspace.getActiveFile() === "t3.md"));

// ── pin via menu ────────────────────────────────────────────────────────────
console.log("— pin —");
await app(async () => {
  window.__app.workspace.openFile("t1.md", { newTab: true });
  window.__app.workspace.openFile("t2.md", { newTab: true });
  await new Promise((r) => setTimeout(r, 200));
});
await page.locator('[data-testid^="tab-bar-"] .tab').first().click({ button: "right" });
await wait(120);
ok("pin item present", await app(() => !!document.querySelector('[data-testid="tabctx-pin"]')));
await page.locator('[data-testid="tabctx-pin"]').click();
await wait(120);
ok("first tab becomes pinned", await app(() => document.querySelector('[data-testid^="tab-bar-"] .tab')?.classList.contains("is-pinned")));
// close-all from another tab keeps the pinned one
await page.locator('[data-testid^="tab-bar-"] .tab').last().click({ button: "right" });
await wait(120);
await page.locator('[data-testid="tabctx-close-all"]').click();
await wait(150);
ok("close all keeps the pinned tab", (await tabCount()) === 1 && (await app(() => document.querySelector('[data-testid^="tab-bar-"] .tab')?.classList.contains("is-pinned"))));

// ── split via menu ──────────────────────────────────────────────────────────
console.log("— split —");
const panesBefore = await paneCount();
await page.locator('[data-testid^="tab-bar-"] .tab').first().click({ button: "right" });
await wait(120);
await page.locator('[data-testid="tabctx-split-right"]').click();
await wait(200);
ok("split right adds a pane", (await paneCount()) > panesBefore, `before=${panesBefore} after=${await paneCount()}`);

// ── menu closes on Escape / outside click ───────────────────────────────────
console.log("— menu dismiss —");
await page.locator('[data-testid^="tab-bar-"] .tab').first().click({ button: "right" });
await wait(120);
ok("menu open before Esc", await app(() => !!document.querySelector('[data-testid="tab-context-menu"]')));
await page.keyboard.press("Escape");
await wait(120);
ok("Escape closes the menu", await app(() => !document.querySelector('[data-testid="tab-context-menu"]')));

console.log(`\nR81 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
