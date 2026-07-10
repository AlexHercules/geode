/**
 * R282 — Editor breadcrumbs path display.
 * Browser :1420.   Run: node .calibration/r282-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 282 additions".
 *
 * A = editor breadcrumbs exists for nested file path.
 * B = breadcrumbs segments match path parts (folder, nested, r282-test).
 * C = separator / exists (Obsidian-style path slash).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r282", name: "r282", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("A. editor breadcrumbs for nested path");
// create nested folders and note
await app(async () => {
  try { await window.__app.vault.remove("folder/nested/r282-test.md"); } catch {}
  try { await window.__app.vault.remove("folder/nested"); } catch {}
  try { await window.__app.vault.remove("folder"); } catch {}
  // createFolder creates intermediate folders automatically
  await window.__app.vault.createFolder("folder/nested");
  await window.__app.vault.create("folder/nested/r282-test.md", "# Test\n");
});
await app(() => window.__app.workspace.openFile("folder/nested/r282-test.md"));
await wait(150);

// check breadcrumbs container exists
const breadcrumbsExists = await page.evaluate(() => {
  return document.querySelector(".editor-breadcrumbs") !== null;
});
ok(".editor-breadcrumbs exists", breadcrumbsExists);

console.log("B. breadcrumbs segments match path");
const segments = await page.evaluate(() => {
  const els = document.querySelectorAll('[data-testid="editor-breadcrumb-segment"]');
  return Array.from(els).map(el => el.textContent?.trim() || "");
});
ok("3 segments found", segments.length === 3, `got ${segments.length}: ${segments.join(", ")}`);
if (segments.length >= 3) {
  ok('segment 0 is "folder"', segments[0] === "folder", segments[0]);
  ok('segment 1 is "nested"', segments[1] === "nested", segments[1]);
  ok('segment 2 is "r282-test"', segments[2] === "r282-test", segments[2]);
}

console.log("C. separator / exists");
const hasSeparator = await page.evaluate(() => {
  const breadcrumbs = document.querySelector(".editor-breadcrumbs");
  if (!breadcrumbs) return false;
  return breadcrumbs.textContent?.includes("/") || false;
});
ok("separator / present", hasSeparator);

// clean up
await app(() => {
  if (window.__app.vault.fileExists("folder/nested/r282-test.md")) {
    window.__app.vault.remove("folder/nested/r282-test.md");
  }
  // folders stay in MemoryVaultAdapter but are harmless; no need to remove
});

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR282: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
