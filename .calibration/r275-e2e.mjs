/**
 * R275 — Files & Links「启用 URI 链接」toggle E2E.
 * Reference: docs/ARCHITECTURE.md "Round 275 additions".
 *
 * Geode's R46 in-app obsidian:// routing is now gated by a setting (default ON to
 * preserve prior behavior; Obsidian's own default is OFF). This suite locks:
 *   - the toggle exists in Files & Links → Advanced
 *   - default is ON and persists across reload
 *   - OFF prevents obsidian:// link clicks from navigating in the reading view
 *   - ON allows obsidian:// link clicks to navigate
 *   - the __geodeUri.handle probe stays ungated (tests the executor directly)
 *
 * Run: node .calibration/r275-e2e.mjs   (dev server :1420 up)
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

const TOGGLE = '[data-testid="settings-uri-links-enabled"]';
const MODE_PREVIEW = '[data-testid="mode-reading-toggle"]';
const INLINE_TITLE = '[data-testid="inline-title"] .inline-title-text';

async function openFilesAndLinks() {
  await page.waitForSelector(".ribbon-btn", { timeout: 15000 });
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('[aria-label*="设置"], [title*="设置"], [aria-label*="Settings" i]')?.click());
  await page.waitForSelector(".settings-nav-item", { timeout: 8000 });
  await page.evaluate(() => {
    const r = /文件与链接|Files/;
    [...document.querySelectorAll(".settings-nav-item")].find((n) => r.test(n.textContent || ""))?.click();
  });
  await page.waitForSelector(TOGGLE, { timeout: 8000 });
}

async function closeSettings() {
  const closeBtn = await page.$('[data-testid="settings-close"]');
  if (closeBtn) {
    await closeBtn.click();
    await page.waitForSelector('[data-testid="settings-modal"]', { state: "hidden", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(100);
}

async function setUriLinksEnabled(enabled) {
  await openFilesAndLinks();
  const current = await page.evaluate((sel) => document.querySelector(sel)?.getAttribute("aria-checked") === "true", TOGGLE);
  if (current !== enabled) {
    await page.click(TOGGLE);
    await page.waitForTimeout(80);
  }
  await closeSettings();
}

const storedUriLinks = () => page.evaluate(() => localStorage.getItem("geode.uriLinksEnabled"));
const toggleOn = () => page.evaluate((sel) => document.querySelector(sel)?.getAttribute("aria-checked") === "true", TOGGLE);
const activeTitle = () => page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim(), INLINE_TITLE);
async function enterReadingView() {
  await page.waitForSelector(MODE_PREVIEW, { timeout: 5000 });
  if (!(await page.$('a[href^="obsidian://"]'))) {
    await page.click(MODE_PREVIEW);
    await page.waitForSelector('a[href^="obsidian://"]', { timeout: 5000 });
  }
}

// =========== Part A: toggle presence + default ON + persistence ===========
console.log("— Part A: Files & Links → Advanced toggle, default ON, persists —");
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.evaluate(() => localStorage.removeItem("geode.uriLinksEnabled"));
await page.reload({ waitUntil: "domcontentloaded" });
await openFilesAndLinks();
{
  const stored = await storedUriLinks();
  ok("toggle exists in Files & Links advanced group", await toggleOn() !== undefined);
  ok("default is ON (preserves Geode pre-R275 behavior)", await toggleOn() === true, await toggleOn());
  ok("absent localStorage defaults to ON behavior", stored === null || stored === "true", stored);

  await page.click(TOGGLE);
  await page.waitForTimeout(80);
  ok("click toggles OFF", await toggleOn() === false, await toggleOn());
  ok("OFF persists to localStorage 'false'", (await storedUriLinks()) === "false", await storedUriLinks());

  await page.reload({ waitUntil: "domcontentloaded" });
  await openFilesAndLinks();
  ok("reload honors OFF", await toggleOn() === false, await toggleOn());

  await page.click(TOGGLE);
  await page.waitForTimeout(80);
  ok("click toggles back ON", await toggleOn() === true, await toggleOn());
}

// =========== Part B: reading-view obsidian:// click is gated by the setting ===========
console.log("— Part B: reading-view obsidian:// click navigation gated —");
{
  await closeSettings();

  // Ensure ON and create target + source via the ungated __geodeUri probe (new action).
  await setUriLinksEnabled(true);
  await page.evaluate(() => window.__geodeUri.handle("obsidian://new?file=r275-target&content=target"));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__geodeUri.handle("obsidian://new?file=r275-source&content=[go](obsidian://open?file=r275-target)"));
  await page.waitForTimeout(200);

  // Switch to reading view and click the obsidian:// link while ON.
  await enterReadingView();
  await page.click('a[href^="obsidian://"]');
  await page.waitForTimeout(200);
  ok("ON: click navigates to r275-target", (await activeTitle()) === "r275-target", await activeTitle());

  // Toggle OFF, reopen source, click again — should stay on source.
  await setUriLinksEnabled(false);
  await page.evaluate(() => window.__geodeUri.handle("obsidian://open?file=r275-source"));
  await page.waitForTimeout(200);
  await enterReadingView();
  await page.click('a[href^="obsidian://"]');
  await page.waitForTimeout(200);
  ok("OFF: click does NOT navigate (stays on r275-source)", (await activeTitle()) === "r275-source", await activeTitle());
}

// =========== Part C: __geodeUri.handle probe remains ungated ===========
console.log("— Part C: __geodeUri.handle probe is NOT gated by the setting —");
{
  // Already OFF from Part B. Create+open a fresh target via the probe.
  await page.evaluate(() => window.__geodeUri.handle("obsidian://new?file=r275-probe-target&content=probe"));
  await page.waitForTimeout(200);
  ok("probe creates/opens r275-probe-target even when setting is OFF", (await activeTitle()) === "r275-probe-target", await activeTitle());
}

ok("no page errors throughout", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(`\nR275 e2e: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exit(1); }
