/**
 * R168 — Tier 8 D-series obsidian util exports — browser :1420.
 * Run: node .calibration/r168-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 168 additions" (Tier 8, D-series utils).
 *
 * The fixture plugin (?obsfixture=1) runs a one-shot async IIFE in onload that
 * exercises the four D-series surfaces and JSON-stringifies every result into a
 * live <div data-testid="fixture-d-results">:
 *   1. apiVersion === "1.8.0" + requireApiVersion gates (1.6.0 / 1.8.0 / 1.9.0)
 *   2. parseLinktext({path, subpath}) — subpath keeps the leading '#'
 *   3. arrayBufferToBase64 / base64ToArrayBuffer / getBlobArrayBuffer round-trip
 *   4. loadMermaid() resolving to an object with a .render function
 * This suite waits for the IIFE (which awaits loadMermaid) to finish, parses the
 * div, and asserts each field. The fixture div is initially empty; the await on
 * loadMermaid means we must poll for non-empty textContent before reading.
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

console.log("— wait for the D-series async IIFE (incl. loadMermaid) to write results —");
await page.waitForFunction(() => {
  const el = document.querySelector("[data-testid=fixture-d-results]");
  return el && el.textContent.length > 0;
}, null, { timeout: 15000 });

const raw = await page.locator("[data-testid=fixture-d-results]").textContent();
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

console.log("— apiVersion + requireApiVersion gates —");
ok('apiVersion === "1.8.0"', out.apiVersion === "1.8.0", `got=${JSON.stringify(out.apiVersion)}`);
ok('requireApiVersion("1.6.0") === true (regression vs old 1.5.0)', out.req16 === true, `got=${out.req16}`);
ok('requireApiVersion("1.8.0") === true (equal case)', out.req180 === true, `got=${out.req180}`);
ok('requireApiVersion("1.9.0") === false (future version)', out.req190 === false, `got=${out.req190}`);

console.log("— parseLinktext shapes (subpath keeps leading #) —");
ok('parseLinktext("Note#heading")',
  JSON.stringify(out.pl_heading) === JSON.stringify({ path: "Note", subpath: "#heading" }),
  JSON.stringify(out.pl_heading));
ok('parseLinktext("Note") — empty subpath',
  JSON.stringify(out.pl_plain) === JSON.stringify({ path: "Note", subpath: "" }),
  JSON.stringify(out.pl_plain));
ok('parseLinktext("Note#^block") — block ref',
  JSON.stringify(out.pl_block) === JSON.stringify({ path: "Note", subpath: "#^block" }),
  JSON.stringify(out.pl_block));
ok('parseLinktext("#heading") — empty path',
  JSON.stringify(out.pl_subonly) === JSON.stringify({ path: "", subpath: "#heading" }),
  JSON.stringify(out.pl_subonly));

console.log("— base64 + blob round-trip over bytes [72,105,33] = 'Hi!' —");
ok('arrayBufferToBase64 === "SGkh"', out.b64 === "SGkh", `got=${JSON.stringify(out.b64)}`);
ok('base64ToArrayBuffer round-trips to "72,105,33"', out.b64_roundtrip === "72,105,33",
  `got=${JSON.stringify(out.b64_roundtrip)}`);
ok('getBlobArrayBuffer yields "72,105,33"', out.blob_bytes === "72,105,33",
  `got=${JSON.stringify(out.blob_bytes)}`);

console.log("— loadMermaid resolves to an object with a .render function —");
ok('loadMermaid().render is a function', out.mermaidRender === "function",
  `got=${JSON.stringify(out.mermaidRender)}`);

console.log("— regression: fixture plugin still enabled —");
const fixtureReport = await page.evaluate(() =>
  window.geode.app.obsidianLoadReport.get().find((r) => r.id === "geode-compat-fixture") ?? null);
ok("fixture plugin present in load report", fixtureReport !== null, JSON.stringify(fixtureReport));
ok("fixture plugin status 'enabled'", fixtureReport?.status === "enabled",
  `status=${fixtureReport?.status} detail=${fixtureReport?.detail ?? ""}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR168: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
