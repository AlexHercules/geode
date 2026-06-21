/**
 * R173 — Tier 8 D9 sanitizeHTMLToDom (SECURITY: XSS vector battery)
 * — browser :1420.
 * Run: node .calibration/r173-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 173 additions" (Tier 8, D9).
 *
 * obsidian.sanitizeHTMLToDom(html) is a conservative allowlist cleaner returning
 * a DocumentFragment. The fixture plugin (?obsfixture=1) runs an IIFE in onload
 * that, for each XSS vector, sanitizes the html → ADOPTS the fragment into the
 * LIVE DOM (so a surviving onerror/script WOULD run) → then asserts:
 *   - dangerous content was REMOVED (no <script>/<iframe>/<svg>, no on* attrs,
 *     no javascript:/control-char-javascript:/data: URLs), and
 *   - it did NOT EXECUTE (window.__xssScript / __xssImg / __xssSvg stay undefined,
 *     snapshotted AFTER a 150ms tick so any stripped handler would have fired), and
 *   - legitimate content SURVIVED (text kept, safe/relative href kept, unknown tag
 *     unwrapped keeping inner, class/data-/aria- kept, comments removed).
 * All results are JSON-stringified into <div data-testid="fixture-d9san-results">.
 * The div fills inside a setTimeout(150) in onload; we poll up to 10s for non-empty
 * textContent before reading (gives the 150ms tick + margin).
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

console.log("— wait for the D9 sanitize security IIFE to write results (150ms tick) —");
await page.waitForFunction(() => {
  const el = document.querySelector("[data-testid=fixture-d9san-results]");
  return el && el.textContent.length > 0;
}, null, { timeout: 10000 });

const raw = await page.locator("[data-testid=fixture-d9san-results]").textContent();
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

console.log("— return shape —");
ok("sanitizeHTMLToDom returns a DocumentFragment", out.returnsFragment === true,
  `got=${JSON.stringify(out.returnsFragment)}`);

console.log("— vector 1: <script> element dropped, text not leaked —");
ok("no <script> element survives", out.noScriptEl === true, `got=${JSON.stringify(out.noScriptEl)}`);
ok("script removed with its text content (textContent === 'keep')", out.scriptText === "keep",
  `got=${JSON.stringify(out.scriptText)}`);

console.log("— vector 2: <img onerror> stripped —");
ok("legit <img> element kept", out.imgPresent === true, `got=${JSON.stringify(out.imgPresent)}`);
ok("img onerror attribute stripped", out.imgNoOnerror === true, `got=${JSON.stringify(out.imgNoOnerror)}`);

console.log("— vector 3: href javascript: stripped —");
ok("<a> element kept", out.aPresent === true, `got=${JSON.stringify(out.aPresent)}`);
ok("javascript: href attribute stripped", out.aNoJsHref === true, `got=${JSON.stringify(out.aNoJsHref)}`);
ok("anchor text kept (=== 'link')", out.aText === "link", `got=${JSON.stringify(out.aText)}`);

console.log("— vector 4: control-char javascript: bypass (java\\tscript:) stripped —");
ok("control-char javascript: href stripped", out.tabJsStripped === true,
  `got=${JSON.stringify(out.tabJsStripped)}`);

console.log("— vector 5: <iframe> dropped —");
ok("no <iframe> survives", out.noIframe === true, `got=${JSON.stringify(out.noIframe)}`);

console.log("— vector 6: onclick on allowed <div> stripped, text kept —");
ok("div onclick attribute stripped", out.divNoOnclick === true, `got=${JSON.stringify(out.divNoOnclick)}`);
ok("div text kept (=== 'ok')", out.divText === "ok", `got=${JSON.stringify(out.divText)}`);

console.log("— legitimate URLs preserved —");
ok("safe https href kept", out.safeHrefKept === true, `got=${JSON.stringify(out.safeHrefKept)}`);
ok("relative href kept", out.relHrefKept === true, `got=${JSON.stringify(out.relHrefKept)}`);

console.log("— vector 9: data: href stripped —");
ok("data: href stripped", out.dataHrefStripped === true, `got=${JSON.stringify(out.dataHrefStripped)}`);

console.log("— vector 10: <svg> + nested <script> dropped —");
ok("no <script> inside svg survives", out.svgScriptGone === true, `got=${JSON.stringify(out.svgScriptGone)}`);
ok("no <svg> element survives", out.svgGone === true, `got=${JSON.stringify(out.svgGone)}`);

console.log("— vector 11: unknown tag unwrapped, inner kept —");
ok("unknown tag unwrapped (no <unknownx>)", out.unknownUnwrapped === true,
  `got=${JSON.stringify(out.unknownUnwrapped)}`);
ok("unknown tag inner content kept", out.unknownInnerKept === true,
  `got=${JSON.stringify(out.unknownInnerKept)}`);

console.log("— vector 12: style attribute stripped —");
ok("style attribute stripped", out.styleStripped === true, `got=${JSON.stringify(out.styleStripped)}`);

console.log("— allowlist attributes: class/data-/aria- kept, arbitrary stripped —");
ok("class attribute kept", out.classKept === true, `got=${JSON.stringify(out.classKept)}`);
ok("data-* attribute kept", out.dataKept === true, `got=${JSON.stringify(out.dataKept)}`);
ok("aria-* attribute kept", out.ariaKept === true, `got=${JSON.stringify(out.ariaKept)}`);
ok("arbitrary 'foo' attribute stripped", out.fooStripped === true, `got=${JSON.stringify(out.fooStripped)}`);

console.log("— comment node removed —");
ok("comment node removed (only the text node remains)", out.commentRemoved === true,
  `got=${JSON.stringify(out.commentRemoved)}`);

console.log("— 🔒 DID-NOT-EXECUTE assertions (the load-bearing security guarantees) —");
ok("script did NOT run (window.__xssScript still undefined)", out.scriptDidNotRun === true,
  `got=${JSON.stringify(out.scriptDidNotRun)}`);
ok("img onerror did NOT fire (window.__xssImg still undefined)", out.imgOnerrorDidNotFire === true,
  `got=${JSON.stringify(out.imgOnerrorDidNotFire)}`);
ok("svg script did NOT run (window.__xssSvg still undefined)", out.svgScriptDidNotRun === true,
  `got=${JSON.stringify(out.svgScriptDidNotRun)}`);

console.log("— regression: fixture plugin still enabled —");
const fixtureReport = await page.evaluate(() =>
  window.geode.app.obsidianLoadReport.get().find((r) => r.id === "geode-compat-fixture") ?? null);
ok("fixture plugin status 'enabled'", fixtureReport?.status === "enabled",
  `status=${fixtureReport?.status} detail=${fixtureReport?.detail ?? ""}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR173: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
