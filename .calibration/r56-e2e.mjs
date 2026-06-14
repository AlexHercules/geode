/**
 * R56 live-preview mermaid E2E — browser vs :1420.
 * Run: node .calibration/r56-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 56 additions".
 *
 *  A. pure detection/placeholder (window.__geodeMermaid): mermaid fence ranges + render.
 *  B. live widget: a ```mermaid fence renders as a diagram (async SVG) when the cursor
 *     is outside, reveals the fence source when the cursor enters, doc never modified.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r56", name: "r56", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeMermaid, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. pure detection + placeholder (window.__geodeMermaid) ──────────────────
console.log("A. pure detection/placeholder (window.__geodeMermaid)");
const DOC = "intro\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```js\nconst x=1;\n```\n\noutro\n";
const ranges = await app(([d]) => window.__geodeMermaid.ranges(d), [DOC]);
ok("finds exactly one mermaid fence (not the js fence)", Array.isArray(ranges) && ranges.length === 1, JSON.stringify(ranges));
ok("range slices to the ```mermaid fence", ranges[0] && DOC.slice(ranges[0].from, ranges[0].to).startsWith("```mermaid"), JSON.stringify(ranges[0]));
ok("renderMarkdownToHtml emits a .geode-mermaid placeholder", await app(() => window.__geodeMermaid.placeholder("```mermaid\ngraph TD\nA-->B\n```")));
ok("a ```js fence is not a mermaid range", (await app(() => window.__geodeMermaid.ranges("```js\nx\n```\n"))).length === 0);
ok("case-sensitive: ```Mermaid is not detected", (await app(() => window.__geodeMermaid.ranges("```Mermaid\nx\n```\n"))).length === 0);

// ── B. live widget (render outside / reveal source inside / doc untouched) ───
console.log("B. live widget");
const SRC = "MM.md";
await app(async (p) => { try { await window.__app.vault.create(p, "intro\n\n```mermaid\ngraph TD\nA-->B\n```\n\noutro\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SRC);
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
const widgets = () => page.locator('[data-testid="cm-live-mermaid"]').count();
ok("mermaid renders as a block widget when cursor outside", (await widgets()) === 1, `widgets=${await widgets()}`);
ok("widget holds the .geode-mermaid placeholder", await app(() => !!document.querySelector('[data-testid="cm-live-mermaid"] .geode-mermaid')));
// the async mermaid render swaps in an <svg> — wait generously for the dynamic import
await page.waitForFunction(() => !!document.querySelector('[data-testid="cm-live-mermaid"] svg'), null, { timeout: 8000 }).catch(() => {});
ok("async render swaps in an <svg> diagram", await app(() => !!document.querySelector('[data-testid="cm-live-mermaid"] svg')));
// move the cursor INTO the fence → source revealed
const mFrom = await app(([p]) => window.__geodeMermaid.ranges(window.__app.documents.get(p)?.getText() ?? "")[0].from, [SRC]);
await app(([from]) => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: from + 5 } }); }, [mFrom]);
await wait(150);
ok("cursor inside the fence reveals the source (widget gone)", (await widgets()) === 0, `widgets=${await widgets()}`);
ok("raw ```mermaid source is visible while editing", (await app(() => document.querySelector(".cm-content")?.textContent ?? "")).includes("graph TD"));
// move back out → widget reappears
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(150);
ok("widget reappears when cursor leaves the fence", (await widgets()) === 1, `widgets=${await widgets()}`);
ok("document bytes untouched by live rendering", (await app(([p]) => window.__app.documents.get(p)?.getText() ?? "", [SRC])) === "intro\n\n```mermaid\ngraph TD\nA-->B\n```\n\noutro\n");
ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR56 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
