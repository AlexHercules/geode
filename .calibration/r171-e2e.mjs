/**
 * R171 — Tier 8 D3 search: prepareFuzzySearch / prepareSimpleSearch
 * — browser :1420.
 * Run: node .calibration/r171-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 171 additions" (Tier 8, D3).
 *
 * The fixture plugin (?obsfixture=1) runs a SYNCHRONOUS IIFE in onload that:
 *   1. prepareFuzzySearch("foo")("foobar") — substring fast-path returns
 *      { score:number, matches:[[0,3]] } (matches are [start,end) intervals).
 *   2. prepareFuzzySearch("fb")("foobar") — in-order non-contiguous chars
 *      (f@0, b@3) still match → non-null.
 *   3. prepareFuzzySearch("xyz")("foobar") — no match → null.
 *   4. A prepared fuzzy scorer is reusable across texts ("afoo" matches,
 *      "zzz" does not).
 *   5. prepareSimpleSearch("foo bar")("xx foo yy bar") — every whitespace-split
 *      token must occur as a substring; 2 matches, sorted by start.
 *   6. prepareSimpleSearch("foo zzz")("foo bar") — a missing token → null.
 *   7. Both exports are functions.
 * Every result is JSON-stringified into <div data-testid="fixture-d3search-results">.
 * The IIFE is synchronous so the div fills during onload; we still poll up to
 * 10s for non-empty textContent (onload itself is async) before reading.
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

await page.goto(BASE_URL + "?obsfixture=1");
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });

console.log("— wait for the D3 search sync IIFE to write results —");
await page.waitForFunction(() => {
  const el = document.querySelector("[data-testid=fixture-d3search-results]");
  return el && el.textContent.length > 0;
}, null, { timeout: 10000 });

const raw = await page.locator("[data-testid=fixture-d3search-results]").textContent();
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

console.log("— prepareFuzzySearch: substring fast-path —");
ok("fuzzy substring scorer returned non-null", out.fuzzySubNonNull === true,
  `got=${JSON.stringify(out.fuzzySubNonNull)}`);
ok("fuzzy substring matches === [[0,3]]", out.fuzzySubMatches === "[[0,3]]",
  `got=${JSON.stringify(out.fuzzySubMatches)}`);
ok("fuzzy substring score is a number", out.fuzzySubScoreNum === true,
  `got=${JSON.stringify(out.fuzzySubScoreNum)}`);

console.log("— prepareFuzzySearch: in-order non-contiguous chars —");
ok("fuzzy in-order chars ('fb' on 'foobar') matched", out.fuzzyCharsNonNull === true,
  `got=${JSON.stringify(out.fuzzyCharsNonNull)}`);

console.log("— prepareFuzzySearch: no match → null —");
ok("fuzzy no-match returned null", out.fuzzyNoMatchIsNull === true,
  `got=${JSON.stringify(out.fuzzyNoMatchIsNull)}`);

console.log("— prepareFuzzySearch: prepared scorer is reusable —");
ok("fuzzy reusable across texts", out.fuzzyReuse === true,
  `got=${JSON.stringify(out.fuzzyReuse)}`);

console.log("— prepareSimpleSearch: all tokens occur —");
ok("simple scorer returned non-null", out.simpleNonNull === true,
  `got=${JSON.stringify(out.simpleNonNull)}`);
ok("simple match count === 2", out.simpleMatchCount === 2,
  `got=${JSON.stringify(out.simpleMatchCount)}`);
ok("simple matches sorted by start", out.simpleSorted === true,
  `got=${JSON.stringify(out.simpleSorted)}`);

console.log("— prepareSimpleSearch: missing token → null —");
ok("simple missing token returned null", out.simpleMissingIsNull === true,
  `got=${JSON.stringify(out.simpleMissingIsNull)}`);

console.log("— both exports are functions —");
ok("prepareFuzzySearch + prepareSimpleSearch are functions", out.fnTypes === true,
  `got=${JSON.stringify(out.fnTypes)}`);

console.log("— regression: fixture plugin still enabled —");
const fixtureReport = await page.evaluate(() =>
  window.geode.app.obsidianLoadReport.get().find((r) => r.id === "geode-compat-fixture") ?? null);
ok("fixture plugin status 'enabled'", fixtureReport?.status === "enabled",
  `status=${fixtureReport?.status} detail=${fixtureReport?.detail ?? ""}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR171: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
