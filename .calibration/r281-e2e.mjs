/**
 * R281 — Markdown preview list guide lines + Explorer density.
 * Browser :1420.   Run: node .calibration/r281-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 281 additions".
 *
 * A = nested list preview has ::before guide line (1px width, border color).
 * B = explorer item height ≤ 24px.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r281", name: "r281", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("A. nested list preview guide line");
// create note with nested list
await app(async () => {
  try { await window.__app.vault.remove("r281-test.md"); } catch {}
  await window.__app.vault.create("r281-test.md",
`- A
  - A1
  - A2
- B
`
  );
});
await app(() => window.__app.workspace.openFile("r281-test.md"));
await wait(150);
// switch to preview mode
await app(() => window.__app.workspace.toggleActiveTabMode());
await wait(150);
// check preview list pseudo-element
const listStyle = await page.evaluate(() => {
  const ul = document.querySelector(".preview-content ul");
  if (!ul) return null;
  const cs = getComputedStyle(ul, "::before");
  // also get --border from root for comparison
  const root = document.documentElement;
  const rootCs = getComputedStyle(root);
  const borderColor = rootCs.getPropertyValue("--border").trim();
  return {
    width: cs.width,
    display: cs.display,
    backgroundColor: cs.backgroundColor,
    borderColor,
  };
});
ok(".preview-content ul exists", listStyle !== null);
if (listStyle) {
  // guide line should have width 1px (or "1px")
  const has1pxWidth = listStyle.width === "1px" || parseInt(listStyle.width, 10) === 1;
  ok("list guide line width is 1px", has1pxWidth, listStyle.width);
  // guide line should be visible (display not none)
  ok("list guide line is visible (display not none)", listStyle.display !== "none", listStyle.display);
}

console.log("B. explorer item density");
// get first explorer item's height
const explorerItemStyle = await page.evaluate(() => {
  const item = document.querySelector(".explorer-item");
  if (!item) return null;
  const cs = getComputedStyle(item);
  return {
    height: cs.height,
  };
});
ok(".explorer-item exists", explorerItemStyle !== null);
if (explorerItemStyle) {
  const height = parseInt(explorerItemStyle.height, 10);
  ok(`explorer item height ≤ 24px (${height}px)`, !isNaN(height) && height <= 24, explorerItemStyle.height);
}

// clean up
await app(() => {
  if (window.__app.vault.fileExists("r281-test.md")) {
    window.__app.vault.remove("r281-test.md");
  }
});

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR281: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
