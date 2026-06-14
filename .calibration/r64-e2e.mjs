/**
 * R64 Outline filter E2E — browser mode against dev :1420.
 * Run: node .calibration/r64-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 64 additions".
 *
 * Covers ㉗ Outline filter (Obsidian core Outline plugin's filter bar):
 * case-insensitive substring filter that shows matching headings + their
 * ancestors (dimmed, for context) but NOT descendants; no-match empty state;
 * clear restores all; filter resets on file change; jump still works.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r64", name: "r64", onload(app) { window.__app = app; } }));

const create = (p, c) => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 60));
}, [p, c]);
const openFile = (p) => page.evaluate(async (path) => {
  window.__app.workspace.openFile(path);
  await new Promise((r) => setTimeout(r, 150));
}, p);
const items = () => page.$$eval('[data-testid="outline-item"]', (els) =>
  els.map((e) => ({ text: e.querySelector(".outline-label")?.textContent ?? "", ancestor: e.classList.contains("is-ancestor") })),
);
const setFilter = async (q) => { await page.fill('[data-testid="outline-filter"]', q); await page.waitForTimeout(80); };

await create("Doc.md", "# Introduction\n\n## Setup\n\n### Install\n\n## Config\n\n# Usage\n\n## Examples\n");
await create("Other.md", "# Solo\n\n## Only\n");

console.log("— open outline pane on a 6-heading note —");
await openFile("Doc.md");
await page.click('[data-testid="right-tab-outline"]');
await page.waitForSelector('[data-testid="outline-panel"]', { timeout: 4000 }).catch(() => {});
ok("filter input present", (await page.$('[data-testid="outline-filter"]')) !== null);
ok("all 6 headings shown unfiltered", (await items()).length === 6, JSON.stringify((await items()).map((i) => i.text)));

console.log("— filter to a deep heading shows it + ancestors (dimmed), not descendants —");
await setFilter("install");
let rows = await items();
ok("filter 'install' → Introduction, Setup, Install", rows.map((r) => r.text).join("|") === "Introduction|Setup|Install", JSON.stringify(rows));
ok("Install is the match (not dimmed)", rows.find((r) => r.text === "Install")?.ancestor === false, JSON.stringify(rows));
ok("Setup + Introduction are dimmed ancestors", rows.filter((r) => r.text !== "Install").every((r) => r.ancestor), JSON.stringify(rows));

console.log("— ancestors shown, descendants NOT —");
await setFilter("setup");
rows = await items();
ok("filter 'setup' → Introduction (ancestor) + Setup (match)", rows.map((r) => r.text).join("|") === "Introduction|Setup", JSON.stringify(rows));
ok("descendant 'Install' NOT shown under a matched parent", !rows.some((r) => r.text === "Install"), JSON.stringify(rows));

console.log("— case-insensitive + no-match empty state —");
await setFilter("USAGE");
ok("case-insensitive: 'USAGE' matches 'Usage'", (await items()).some((r) => r.text === "Usage"), JSON.stringify(await items()));
await setFilter("zzznope");
ok("no-match → 0 items", (await items()).length === 0, String((await items()).length));
ok("no-match → empty-state message", (await page.$('[data-testid="outline-empty"]')) !== null);

console.log("— clear restores all; jump still works —");
await setFilter("config");
await page.evaluate(() => {
  const lbl = [...document.querySelectorAll('[data-testid="outline-item"] .outline-label')].find((b) => b.textContent === "Config");
  lbl?.click();
});
await page.waitForTimeout(150);
ok("clicking a filtered heading keeps Doc.md active (jump works)", (await page.evaluate(() => window.__app.workspace.getActiveFile())) === "Doc.md");
await setFilter("");
ok("clearing the filter restores all 6 headings", (await items()).length === 6, String((await items()).length));

console.log("— filter resets on file change —");
await setFilter("intro");
ok("filter active before switch (1+ rows)", (await items()).length >= 1);
await openFile("Other.md");
await page.waitForTimeout(120);
const filterVal = await page.$eval('[data-testid="outline-filter"]', (e) => e.value).catch(() => "?");
ok("filter input cleared after switching files", filterVal === "", JSON.stringify(filterVal));
ok("Other.md shows its 2 headings unfiltered", (await items()).length === 2, JSON.stringify((await items()).map((i) => i.text)));

console.log(`\nR64 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
