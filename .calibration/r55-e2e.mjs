/**
 * R55 live-preview tables E2E — browser vs :1420.
 * Run: node .calibration/r55-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 55 additions".
 *
 *  A. pure detection/render (window.__geodeTable): Table ranges + renderMarkdownToHtml.
 *  B. live widget: a table renders as <table> when the cursor is outside, reveals the
 *     pipe source when the cursor/click enters, and the document is never modified.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r55", name: "r55", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeTable, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. pure detection + render (window.__geodeTable) ─────────────────────────
console.log("A. pure detection/render (window.__geodeTable)");
const DOC = "intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\noutro\n";
const ranges = await app(([d]) => window.__geodeTable.ranges(d), [DOC]);
ok("finds exactly one GFM table", Array.isArray(ranges) && ranges.length === 1, JSON.stringify(ranges));
ok("table range slices to the pipe source", ranges[0] && DOC.slice(ranges[0].from, ranges[0].to).startsWith("| A | B |"), JSON.stringify(ranges[0]));
ok("renderMarkdownToHtml emits a <table>", await app(() => window.__geodeTable.renders("| A | B |\n|---|---|\n| 1 | 2 |")));
ok("a plain paragraph yields no table range", (await app(() => window.__geodeTable.ranges("just text\nno pipes\n"))).length === 0);

// ── B. live widget (render outside / reveal source inside / doc untouched) ───
console.log("B. live widget");
const SRC = "TB.md";
await app(async (p) => { try { await window.__app.vault.create(p, "intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\noutro\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SRC);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, SRC);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await wait(80);
// cursor at doc start (outside the table) → table renders as a widget
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(120);
const widgets = () => page.locator('[data-testid="cm-live-table"]').count();
ok("table renders as a block widget when cursor outside", (await widgets()) === 1, `widgets=${await widgets()}`);
const widgetText = await app(() => document.querySelector('[data-testid="cm-live-table"]')?.textContent ?? "");
ok("widget contains the rendered cell text", widgetText.includes("A") && widgetText.includes("1"), JSON.stringify(widgetText));
ok("widget DOM contains a real <table>", await app(() => !!document.querySelector('[data-testid="cm-live-table"] table')));
// move the cursor INTO the table → source revealed (widget gone, raw pipes visible)
const tFrom = (await app(([p]) => window.__geodeTable.ranges(window.__app.documents.get(p)?.getText() ?? "")[0].from, [SRC]));
await app(([from]) => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: from + 3 } }); }, [tFrom]);
await wait(120);
ok("cursor inside the table reveals the source (widget gone)", (await widgets()) === 0, `widgets=${await widgets()}`);
ok("raw pipe source is visible while editing", (await app(() => document.querySelector(".cm-content")?.textContent ?? "")).includes("| A | B |"));
// move back out → widget reappears
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(120);
ok("widget reappears when cursor leaves the table", (await widgets()) === 1, `widgets=${await widgets()}`);
// the document was never modified by the rendering
ok("document bytes untouched by live rendering", (await app(([p]) => window.__app.documents.get(p)?.getText() ?? "", [SRC])) === "intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\noutro\n");
// no uncaught page errors (e.g. block-decoration measure loop)
ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

// ── C. nested table guard (review major fix) ─────────────────────────────────
console.log("C. nested-table guard (blockquote keeps source)");
const SRC2 = "TB2.md";
await app(async (p) => { try { await window.__app.vault.create(p, "top\n\n| X | Y |\n|---|---|\n| 9 | 8 |\n\n> | A | B |\n> |---|---|\n> | 1 | 2 |\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SRC2);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, SRC2);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(140);
// only the top-level table renders as a widget; the blockquote table keeps its source
ok("only the line-aligned (top-level) table is a widget", (await widgets()) === 1, `widgets=${await widgets()}`);
// the blockquote table is NOT block-replaced — its pipe source stays in the editor
// (Geode's live preview hides the blockquote `>` marker, so the source reads "| A | B |")
ok("blockquote table keeps its pipe source", (await app(() => document.querySelector(".cm-content")?.textContent ?? "")).includes("| A | B |"));
ok("no page errors with a blockquote table present", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR55 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
