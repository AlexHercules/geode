/**
 * R136 reading-view getSectionInfo (opt-in sourcePos → block data-line) E2E — browser mode :1420.
 * Run: node .calibration/r136-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 136 additions".
 *
 * The reading view renders with sourcePos:true → top-level blocks carry data-line / data-line-end;
 * a post-processor's ctx.getSectionInfo(el) walks el.closest("[data-line]") → {text,lineStart,lineEnd}.
 * Custom-rendered blocks (fences) + the container have no data-line → getSectionInfo returns null.
 * (The byte-invariant half — default render path unchanged — is r26-bytes 0 violations, run separately.)
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const eqSec = (s, lineStart, lineEnd, text) =>
  s && typeof s === "object" && s.lineStart === lineStart && s.lineEnd === lineEnd && s.text === text;

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r136", name: "r136", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && typeof window.__geodeRegisterMarkdownPostProcessor === "function", null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DOC = "# Title\n\npara one\npara two\n\n- item a\n- item b\n\n```js\ncode\n```\n";
const SRC = "r136-read.md";

// a post-processor that records getSectionInfo for several rendered block elements
await app(() => {
  window.__si = {};
  window.__siDispose = window.__geodeRegisterMarkdownPostProcessor((el, ctx) => {
    const q = (sel) => el.querySelector(sel);
    window.__si = {
      dataLineCount: el.querySelectorAll("[data-line]").length,
      h1: ctx.getSectionInfo(q("h1")),
      p: ctx.getSectionInfo(q("p")),
      ul: ctx.getSectionInfo(q("ul")),
      li: ctx.getSectionInfo(q("li")),
      pre: q("pre") ? ctx.getSectionInfo(q("pre")) : "no-pre",
      container: ctx.getSectionInfo(el),
    };
  });
});
await app(async ([p, d]) => {
  try { await window.__app.vault.create(p, d); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "preview");
  await new Promise((r) => setTimeout(r, 250));
}, [SRC, DOC]);
await page.waitForSelector(".preview-content", { state: "attached", timeout: 5000 });
await wait(200);

console.log("— sourcePos emits data-line on top-level blocks (reading view) —");
const si = await app(() => window.__si);
ok("the reading view emitted [data-line] on blocks (h1/p/ul ≥ 3)", si.dataLineCount >= 3, JSON.stringify(si.dataLineCount));

console.log("— ctx.getSectionInfo maps a rendered element → its source-line range —");
ok("getSectionInfo(h1) = lines 0..0 + full source text", eqSec(si.h1, 0, 0, DOC), JSON.stringify(si.h1));
ok("getSectionInfo(p) = lines 2..3 (the soft-wrapped paragraph)", eqSec(si.p, 2, 3, DOC), JSON.stringify(si.p));
ok("getSectionInfo(ul) = lines 5..6 (the list section)", eqSec(si.ul, 5, 6, DOC), JSON.stringify(si.ul));
ok("getSectionInfo(li) resolves to the list section (closest [data-line]) = 5..6", eqSec(si.li, 5, 6, DOC), JSON.stringify(si.li));

console.log("— unmappable elements return null (Obsidian-faithful) —");
ok("getSectionInfo(pre) = null (custom-rendered fence has no data-line, v1 gap)", si.pre === null, JSON.stringify(si.pre));
ok("getSectionInfo(container) = null (.preview-content carries no data-line)", si.container === null, JSON.stringify(si.container));

console.log("— the data-line attrs carry the expected start/end on the actual DOM —");
ok("h1 element has data-line='0' data-line-end='0'", (await app(() => { const h = document.querySelector(".preview-content h1"); return h?.getAttribute("data-line") + "/" + h?.getAttribute("data-line-end"); })) === "0/0");
ok("ul element has data-line='5' data-line-end='6'", (await app(() => { const u = document.querySelector(".preview-content ul"); return u?.getAttribute("data-line") + "/" + u?.getAttribute("data-line-end"); })) === "5/6");
ok("the ```js fence (custom render) has NO data-line attr", (await app(() => document.querySelector(".preview-content pre")?.hasAttribute("data-line"))) === false);

await app(() => window.__siDispose());

console.log("— review MINOR fix: getSectionInfo on a task checkbox resolves to its list section, not {…,0} —");
// the legacy task checkbox carries data-line but NO data-line-end; closest("[data-line-end]") must
// skip it and resolve to the enclosing <ul> (lines 2..3), never return an inverted {lineStart, 0}.
await app(() => {
  window.__tsi = {};
  window.__tsiDispose = window.__geodeRegisterMarkdownPostProcessor((el, ctx) => {
    const box = el.querySelector("input.task-checkbox");
    const ul = el.querySelector("ul");
    window.__tsi = { box: box ? ctx.getSectionInfo(box) : "no-box", ul: ctx.getSectionInfo(ul) };
  });
});
const TDOC = "# H\n\n- [ ] todo two\n- [x] done three\n";
await app(async ([p, d]) => {
  try { await window.__app.vault.create(p, d); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "preview");
  await new Promise((r) => setTimeout(r, 250));
}, ["r136-tasks.md", TDOC]);
await page.waitForSelector(".preview-content input.task-checkbox", { state: "attached", timeout: 5000 });
await wait(150);
const tsi = await app(() => window.__tsi);
ok("getSectionInfo(task checkbox) resolves to the list section (lines 2..3), not inverted", eqSec(tsi.box, 2, 3, TDOC), JSON.stringify(tsi.box));
ok("getSectionInfo(ul) of the task list = lines 2..3", eqSec(tsi.ul, 2, 3, TDOC), JSON.stringify(tsi.ul));
await app(() => window.__tsiDispose());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR136 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
