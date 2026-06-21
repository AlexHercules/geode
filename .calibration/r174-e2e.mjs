/**
 * R174 — Tier 8 D12+D16 surface (getLanguage / getIcon / getIconIds /
 * Platform.resourcePathPrefix + fileManager.getAvailablePathForAttachment /
 * getNewFileParent) — browser :1420.
 * Run: node .calibration/r174-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 174 additions" (Tier 8, D12+D16).
 *
 * The fixture plugin (?obsfixture=1) runs an async IIFE in onload that calls each
 * new API and JSON-stringifies the results into <div data-testid="fixture-d1216-results">.
 * Asserted here:
 *   D16-1 getLanguage()              → "en" (we preset localStorage geode.locale=en
 *                                       via addInitScript BEFORE goto, so first load is en)
 *   D16-2 getIcon(builtinId)         → SVGSVGElement; getIcon(unknown) → null
 *   D16-3 getIconIds()               → non-empty string[]
 *   D16   Platform.resourcePathPrefix → "" (honest placeholder), typeof string
 *   D12-5 getAvailablePathForAttachment("r174-img.png") → non-empty string ending in .png
 *   D12-6 getNewFileParent("r174-note.md")              → TFolder with a .path string
 * getAvailablePathForAttachment is async, so the div fills after the awaits settle;
 * we poll up to 10s for non-empty textContent before reading.
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

// getLanguage() must read "en" — preset the locale BEFORE any page script runs so
// the very first load resolves to "en" (addInitScript runs before page scripts).
await page.addInitScript(() => {
  try { localStorage.setItem("geode.locale", "en"); } catch {}
});

await page.goto(BASE_URL + "?obsfixture=1");
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });

console.log("— wait for the D12+D16 async IIFE to write results —");
await page.waitForFunction(() => {
  const el = document.querySelector("[data-testid=fixture-d1216-results]");
  return el && el.textContent.length > 0;
}, null, { timeout: 10000 });

const raw = await page.locator("[data-testid=fixture-d1216-results]").textContent();
let out;
try {
  out = JSON.parse(raw);
} catch (e) {
  out = null;
  ok("results div parses as JSON", false, `raw=${raw} err=${String(e)}`);
}
out = out ?? {};

console.log("— no exception inside the IIFE —");
ok("IIFE completed without throwing (out.ok)", out.ok === true, `error=${out.error ?? ""}`);

console.log("— D16-1 getLanguage() —");
ok("getLanguage() === 'en' (e2e-preset locale)", out.lang === "en", `got=${JSON.stringify(out.lang)}`);
ok("getLanguage() returns a string", out.langIsString === true, `got=${JSON.stringify(out.langIsString)}`);

console.log("— D16-3 getIconIds() —");
ok("getIconIds() returns an array", out.iconIdsIsArray === true, `got=${JSON.stringify(out.iconIdsIsArray)}`);
ok("getIconIds() is non-empty", out.iconIdsNonEmpty === true, `got=${JSON.stringify(out.iconIdsNonEmpty)}`);

console.log("— D16-2 getIcon() —");
ok("getIcon(builtinId) returns an SVGSVGElement", out.iconIsSvg === true, `got=${JSON.stringify(out.iconIsSvg)}`);
ok("getIcon(unknown) returns null", out.iconNullForUnknown === true, `got=${JSON.stringify(out.iconNullForUnknown)}`);

console.log("— D16 Platform.resourcePathPrefix —");
ok("Platform.resourcePathPrefix === '' (honest placeholder)", out.resourcePathPrefix === "",
  `got=${JSON.stringify(out.resourcePathPrefix)}`);
ok("Platform.resourcePathPrefix is a string", out.resourcePrefixIsString === true,
  `got=${JSON.stringify(out.resourcePrefixIsString)}`);

console.log("— D12-5 getAvailablePathForAttachment() —");
ok("getAvailablePathForAttachment() returns a non-empty string", out.attPathIsString === true,
  `got=${JSON.stringify(out.attPathIsString)}`);
ok("getAvailablePathForAttachment() path ends in .png", out.attPathHasExt === true,
  `got=${JSON.stringify(out.attPathHasExt)}`);

console.log("— D12-6 getNewFileParent() —");
ok("getNewFileParent() returns a TFolder with a .path string", out.parentHasPath === true,
  `got=${JSON.stringify(out.parentHasPath)}`);

console.log("— regression: fixture plugin still enabled —");
const fixtureReport = await page.evaluate(() =>
  window.geode.app.obsidianLoadReport.get().find((r) => r.id === "geode-compat-fixture") ?? null);
ok("fixture plugin status 'enabled'", fixtureReport?.status === "enabled",
  `status=${fixtureReport?.status} detail=${fixtureReport?.detail ?? ""}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR174: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
