/**
 * R169 — Tier 8 D7: global sleep/nextFrame + Document.on/off delegated listeners
 * — browser :1420.
 * Run: node .calibration/r169-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 169 additions" (Tier 8, D7).
 *
 * The fixture plugin (?obsfixture=1) runs a one-shot async IIFE in onload that:
 *   1. sleep(25) — resolves after ~ms; we assert the elapsed time crossed a
 *      jitter-tolerant floor (>= 15ms).
 *   2. nextFrame() — resolves on the next animation frame.
 *   3. document.on/off — delegated click listener fires only when a bubbled
 *      event's target.closest(selector) matches; handler receives
 *      (ev, delegateTarget); off() removes it. A non-matching click never fires.
 *   4. regression — HTMLElement.prototype.on/off still delegate (the element +
 *      document variants share one impl after this round's refactor).
 * Every result is JSON-stringified into <div data-testid="fixture-d7-results">.
 * Because the IIFE awaits sleep + a frame, the div starts empty; we poll for
 * non-empty textContent before reading.
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

console.log("— wait for the D7 async IIFE (sleep + nextFrame + event probes) to write results —");
await page.waitForFunction(() => {
  const el = document.querySelector("[data-testid=fixture-d7-results]");
  return el && el.textContent.length > 0;
}, null, { timeout: 10000 });

const raw = await page.locator("[data-testid=fixture-d7-results]").textContent();
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

console.log("— global sleep + nextFrame —");
ok("sleep(25) elapsed >= 15ms (jitter-tolerant)", out.sleepElapsedOk === true,
  `got=${JSON.stringify(out.sleepElapsedOk)}`);
ok("nextFrame() resolved", out.nextFrameOk === true, `got=${JSON.stringify(out.nextFrameOk)}`);

console.log("— Document.on/off delegated listeners —");
ok("delegate fired once after a matching click", out.firesAfterFirstClick === 1,
  `got=${JSON.stringify(out.firesAfterFirstClick)}`);
ok("delegateTarget is the matched element", out.delegateTargetOk === true,
  `got=${JSON.stringify(out.delegateTargetOk)}`);
ok("a non-matching click does not fire (still 1)", out.firesAfterNonMatchClick === 1,
  `got=${JSON.stringify(out.firesAfterNonMatchClick)}`);
ok("off() removes the delegate (still 1)", out.firesAfterOff === 1,
  `got=${JSON.stringify(out.firesAfterOff)}`);

console.log("— regression: HTMLElement.prototype.on/off (shared impl) —");
ok("element-level on fired once", out.elOnFires === 1, `got=${JSON.stringify(out.elOnFires)}`);
ok("element-level off removed the delegate (still 1)", out.elOffFires === 1,
  `got=${JSON.stringify(out.elOffFires)}`);

console.log("— regression: fixture plugin still enabled —");
const fixtureReport = await page.evaluate(() =>
  window.geode.app.obsidianLoadReport.get().find((r) => r.id === "geode-compat-fixture") ?? null);
ok("fixture plugin status 'enabled'", fixtureReport?.status === "enabled",
  `status=${fixtureReport?.status} detail=${fixtureReport?.detail ?? ""}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR169: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
