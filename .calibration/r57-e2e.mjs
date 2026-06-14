/**
 * R57 live-preview display math E2E — browser vs :1420.
 * Run: node .calibration/r57-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 57 additions".
 *
 *  A. pure detection/placeholder (window.__geodeMath): $$ block ranges (renderer-
 *     confirmed) + the .geode-math-block placeholder.
 *  B. live widget: a $$…$$ block renders as KaTeX (async) when the cursor is outside,
 *     reveals the $$ source when the cursor enters, doc never modified.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r57", name: "r57", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeMath, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. pure detection + placeholder (window.__geodeMath) ─────────────────────
console.log("A. pure detection/placeholder (window.__geodeMath)");
const DOC = "intro\n\n$$\n\\frac{a}{b}\n$$\n\noutro\n";
const ranges = await app(([d]) => window.__geodeMath.ranges(d), [DOC]);
ok("finds exactly one $$ block", Array.isArray(ranges) && ranges.length === 1, JSON.stringify(ranges));
ok("range slices to the $$…$$ block", ranges[0] && DOC.slice(ranges[0].from, ranges[0].to) === "$$\n\\frac{a}{b}\n$$", JSON.stringify(ranges[0]));
ok("single-line $$x$$ is a block", (await app(() => window.__geodeMath.ranges("$$x^2$$\n"))).length === 1);
ok("`$$x$$ foo` (inner-close not at end) is NOT a block", (await app(() => window.__geodeMath.ranges("$$x$$ foo\n"))).length === 0);
ok("unterminated $$ is NOT a block", (await app(() => window.__geodeMath.ranges("$$\nx\nno close\n"))).length === 0);
ok("inline $x$ is NOT a block", (await app(() => window.__geodeMath.ranges("a $x$ b\n"))).length === 0);
ok("renderMarkdownToHtml emits a .geode-math-block placeholder", await app(() => window.__geodeMath.placeholder("$$\nx\n$$")));

// ── B. live widget (render outside / reveal source inside / doc untouched) ───
console.log("B. live widget");
const SRC = "MA.md";
await app(async (p) => { try { await window.__app.vault.create(p, "intro\n\n$$\n\\frac{a}{b}\n$$\n\noutro\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SRC);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, SRC);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await wait(80);
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(150);
const widgets = () => page.locator('[data-testid="cm-live-math"]').count();
ok("$$ block renders as a block widget when cursor outside", (await widgets()) === 1, `widgets=${await widgets()}`);
ok("widget holds the .geode-math-block placeholder", await app(() => !!document.querySelector('[data-testid="cm-live-math"] .geode-math-block')));
// async KaTeX render swaps in .katex
await page.waitForFunction(() => !!document.querySelector('[data-testid="cm-live-math"] .katex'), null, { timeout: 8000 }).catch(() => {});
ok("async render swaps in KaTeX (.katex)", await app(() => !!document.querySelector('[data-testid="cm-live-math"] .katex')));
// move the cursor INTO the block → source revealed
const mFrom = await app(([p]) => window.__geodeMath.ranges(window.__app.documents.get(p)?.getText() ?? "")[0].from, [SRC]);
await app(([from]) => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: from + 3 } }); }, [mFrom]);
await wait(150);
ok("cursor inside the block reveals the source (widget gone)", (await widgets()) === 0, `widgets=${await widgets()}`);
ok("raw $$ source is visible while editing", (await app(() => document.querySelector(".cm-content")?.textContent ?? "")).includes("\\frac{a}{b}"));
// move back out → widget reappears
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(150);
ok("widget reappears when cursor leaves the block", (await widgets()) === 1, `widgets=${await widgets()}`);
ok("document bytes untouched by live rendering", (await app(([p]) => window.__app.documents.get(p)?.getText() ?? "", [SRC])) === "intro\n\n$$\n\\frac{a}{b}\n$$\n\noutro\n");
ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

// ── C. indented-math guard (review D1) ───────────────────────────────────────
console.log("C. indented-math guard (top-level only)");
// pure: an indented (list-item) $$ is NOT a widget range; only the top-level one is
ok("list-indented $$ is not a widget range", (await app(() => window.__geodeMath.ranges("- item\n  $$\n  x\n  $$\n").length)) === 0);
ok("top-level $$ alongside indented still detected", (await app(() => window.__geodeMath.ranges("- item\n  $$\n  x\n  $$\n\n$$\ntop\n$$\n").length)) === 1);
const SRC2 = "MA2.md";
await app(async (p) => { try { await window.__app.vault.create(p, "- item\n  $$\n  x\n  $$\n\n$$\ntop\n$$\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SRC2);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, SRC2);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(150);
ok("only the top-level $$ becomes a widget (indented stays source)", (await widgets()) === 1, `widgets=${await widgets()}`);
ok("list-indented math source stays visible", (await app(() => document.querySelector(".cm-content")?.textContent ?? "")).includes("- item"));

console.log(`\nR57 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
