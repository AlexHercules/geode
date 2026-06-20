/**
 * R141 command palette "recently used commands at top" E2E — browser mode :1420.
 * Run: node .calibration/r141-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 141 additions".
 *
 * Obsidian 1.8.3+ shows recently-used commands at the top of the palette (empty query). R141: running
 * a command from the palette records it in a per-vault localStorage MRU; the empty-query branch lists
 * recents (MRU order) first, then the rest. Typing falls back to fuzzy (recents don't break search).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r141", name: "r141", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

// clear any prior recents (determinism) + register two benign no-op test commands
await page.evaluate(() => {
  Object.keys(localStorage).filter((k) => k.startsWith("geode.cmdRecent:")).forEach((k) => localStorage.removeItem(k));
  window.__app.commands.register({ id: "r141:alpha", name: "ZZQ Alpha Command", callback: () => { window.__ran = "alpha"; } });
  window.__app.commands.register({ id: "r141:beta", name: "ZZQ Beta Command", callback: () => { window.__ran = "beta"; } });
});

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const openPalette = async () => { await app(() => window.__app.workspace.openModal("palette")); await page.waitForSelector('[data-testid="palette-input"]', { timeout: 3000 }); };
const closePalette = () => app(() => window.__app.workspace.closeModal());
const firstItems = (n) => app(([k]) => [...document.querySelectorAll('[data-testid="palette-item"] .palette-item-name')].slice(0, k).map((e) => e.textContent), [n]);
// run a command via the palette: type its name (fuzzy → top), Enter
const runViaPalette = async (typed) => {
  await openPalette();
  await page.fill('[data-testid="palette-input"]', typed);
  await wait(80);
  await page.locator('[data-testid="palette-input"]').press("Enter"); // executes top match + records + closes
  await wait(80);
};

console.log("— running a command from the palette puts it at the TOP on reopen (empty query) —");
await runViaPalette("ZZQ Alpha");
ok("the Alpha command was executed", (await app(() => window.__ran)) === "alpha");
await openPalette();
let top = await firstItems(1);
ok("on reopen (empty query) the most-recent command is first", top[0] === "ZZQ Alpha Command", JSON.stringify(top));
await closePalette();

console.log("— MRU order: the most-recently-run command is first, the prior one second —");
await runViaPalette("ZZQ Beta");
ok("the Beta command was executed", (await app(() => window.__ran)) === "beta");
await openPalette();
const top2 = await firstItems(2);
ok("Beta (just run) is first", top2[0] === "ZZQ Beta Command", JSON.stringify(top2));
ok("Alpha (run earlier) is second", top2[1] === "ZZQ Alpha Command", JSON.stringify(top2));
await closePalette();

console.log("— typing a query falls back to FUZZY (recents don't override search) —");
await openPalette();
await page.fill('[data-testid="palette-input"]', "Beta");
await wait(100);
const fuzzy = await firstItems(5);
ok("query 'Beta' → Beta on top (fuzzy), even though Alpha is more-recent", fuzzy[0] === "ZZQ Beta Command", JSON.stringify(fuzzy));
ok("the more-recent but non-matching Alpha is fuzzy-filtered OUT", !fuzzy.includes("ZZQ Alpha Command"), JSON.stringify(fuzzy));
await closePalette();

console.log("— a recent id that is no longer registered/available is skipped (no crash) —");
await app(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith("geode.cmdRecent:"));
  const arr = JSON.parse(localStorage.getItem(k));
  localStorage.setItem(k, JSON.stringify(["r141:ghost-unregistered", ...arr])); // inject a dead id at the front
});
await openPalette();
const afterGhost = await firstItems(2);
ok("a dead recent id is skipped, the live recent (Beta) is still first", afterGhost[0] === "ZZQ Beta Command", JSON.stringify(afterGhost));
ok("no crash from the unregistered recent id", pageErrors.length === 0, pageErrors.join(" | "));
await closePalette();

console.log("— recents persist across a reload (per-vault localStorage) —");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r141b", name: "r141b", onload(app) { window.__app = app; window.__app.commands.register({ id: "r141:beta", name: "ZZQ Beta Command", callback: () => {} }); } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openPalette();
const afterReload = await firstItems(1);
ok("after reload, the persisted recent (Beta) is still first", afterReload[0] === "ZZQ Beta Command", JSON.stringify(afterReload));
await closePalette();

console.log("— review D1: a corrupt/external duplicate recent id renders the command only ONCE —");
await app(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith("geode.cmdRecent:")) ?? "geode.cmdRecent:vault";
  localStorage.setItem(k, JSON.stringify(["r141:beta", "r141:beta", "r141:beta"])); // corrupt: triplicate
});
await openPalette();
const betaCount = await app(() => [...document.querySelectorAll('[data-testid="palette-item"] .palette-item-name')].filter((e) => e.textContent === "ZZQ Beta Command").length);
ok("a duplicated recent id is deduped → Beta renders exactly once (no React key collision)", betaCount === 1, `count=${betaCount}`);
ok("no React key-collision / duplicate-child page errors", pageErrors.length === 0, pageErrors.join(" | "));
await closePalette();

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR141 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
