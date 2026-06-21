/**
 * R170 — Tier 8 D9 math: renderMath / finishRenderMath / loadMathJax
 * — browser :1420.
 * Run: node .calibration/r170-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 170 additions" (Tier 8, D9).
 *
 * The fixture plugin (?obsfixture=1) runs a one-shot async IIFE in onload that:
 *   1. renderMath("x^2", false) — SYNC returns an HTMLElement with class
 *      "math math-inline" (textContent=source fallback before typeset).
 *   2. renderMath("\frac{1}{2}", true) — display/block: class "math math-block".
 *   3. renderMath("\frac{", false) — invalid LaTeX must NOT throw on render
 *      (throwOnError:false).
 *   4. finishRenderMath() — awaits the render queue; after it resolves, the
 *      inline/block els contain a .katex child and the inline el got is-loaded.
 *   5. loadMathJax() — prewarms KaTeX, resolves.
 * Every result is JSON-stringified into <div data-testid="fixture-d9math-results">.
 * Because the IIFE awaits the (dynamically imported) KaTeX typeset, the div
 * starts empty; we poll up to 10s for non-empty textContent before reading.
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

console.log("— wait for the D9 math async IIFE (KaTeX dynamic import + typeset) to write results —");
await page.waitForFunction(() => {
  const el = document.querySelector("[data-testid=fixture-d9math-results]");
  return el && el.textContent.length > 0;
}, null, { timeout: 10000 });

const raw = await page.locator("[data-testid=fixture-d9math-results]").textContent();
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

console.log("— renderMath returns a sync HTMLElement with the right class —");
ok("renderMath returned an HTMLElement", out.inlineIsElement === true,
  `got=${JSON.stringify(out.inlineIsElement)}`);
ok("inline el className contains 'math-inline'",
  typeof out.inlineClass === "string" && out.inlineClass.includes("math-inline"),
  `got=${JSON.stringify(out.inlineClass)}`);
ok("display el className contains 'math-block'",
  typeof out.blockClass === "string" && out.blockClass.includes("math-block"),
  `got=${JSON.stringify(out.blockClass)}`);

console.log("— throwOnError:false → invalid LaTeX does not throw on render —");
ok("invalid LaTeX renderMath did not throw", out.invalidNoThrowOnRender === true,
  `got=${JSON.stringify(out.invalidNoThrowOnRender)}`);

console.log("— finishRenderMath resolves + typeset landed —");
ok("finishRenderMath() resolved", out.finishResolved === true,
  `got=${JSON.stringify(out.finishResolved)}`);
ok("inline el has a .katex child after finish", out.inlineHasKatex === true,
  `got=${JSON.stringify(out.inlineHasKatex)}`);
ok("inline el got 'is-loaded' class after finish", out.inlineIsLoaded === true,
  `got=${JSON.stringify(out.inlineIsLoaded)}`);
ok("block el has a .katex child after finish", out.blockHasKatex === true,
  `got=${JSON.stringify(out.blockHasKatex)}`);

console.log("— loadMathJax prewarm resolves —");
ok("loadMathJax() resolved", out.loadMathJaxResolved === true,
  `got=${JSON.stringify(out.loadMathJaxResolved)}`);

console.log("— regression: fixture plugin still enabled —");
const fixtureReport = await page.evaluate(() =>
  window.geode.app.obsidianLoadReport.get().find((r) => r.id === "geode-compat-fixture") ?? null);
ok("fixture plugin status 'enabled'", fixtureReport?.status === "enabled",
  `status=${fixtureReport?.status} detail=${fixtureReport?.detail ?? ""}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR170: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
