/**
 * R133 compat Plugin.registerMarkdownCodeBlockProcessor E2E (reading view) — browser mode :1420.
 * Run: node .calibration/r133-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 133 additions" (compat 商业主轴 · Dataview/Tasks 主要机制).
 *
 * Obsidian registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => …) — sugar over a post-
 * processor that removes the rendered ```lang <pre><code> and hands the handler a fresh <div> to
 * fill (Dataview's `dataview` block, Tasks' `tasks` block). Geode reuses the R132 registry +
 * makeCodeBlockPostProcessor (core, rendering-aware). Reading view only; additive display-only.
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
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r133", name: "r133", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && typeof window.__geodeRegisterMarkdownCodeBlockProcessor === "function", null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

// register a code-block processor for ```testblock that records source/ctx + fills the div
await app(() => {
  window.__cb = { source: null, path: null, isDiv: false };
  window.__cbDispose = window.__geodeRegisterMarkdownCodeBlockProcessor("testblock", (source, el, ctx) => {
    window.__cb.source = source;
    window.__cb.path = ctx && ctx.sourcePath;
    window.__cb.isDiv = el.tagName === "DIV";
    el.className = "cb-rendered";
    el.setAttribute("data-cb", "applied");
    el.textContent = "RENDERED:" + source;
  });
});

// a note with a ```testblock (registered) AND a ```js (NOT registered) fence, opened in preview
await app(async () => {
  try { await window.__app.vault.create("cb.md", "# Heading\n\n```testblock\nline one\nline two\n```\n\n```js\nconst x = 1;\n```\n\nafter\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("cb.md");
  const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "preview");
});
await page.waitForSelector(".preview-content .cb-rendered", { state: "attached", timeout: 5000 });

console.log("— the registered ```testblock fence is replaced + handed to the handler —");
const cb = await app(() => ({ ...window.__cb }));
ok("handler received source = the block content (trailing \\n stripped)", cb.source === "line one\nline two", JSON.stringify(cb.source));
ok("handler received ctx.sourcePath === 'cb.md'", cb.path === "cb.md", JSON.stringify(cb.path));
ok("the el handed to the handler is a fresh <div> (not the <pre>/<code>)", cb.isDiv === true);
ok("the rendered <div> carries the handler output", (await app(() => document.querySelector(".preview-content .cb-rendered")?.textContent ?? null)) === "RENDERED:line one\nline two");
ok("the original ```testblock <pre><code> is gone (replaced)", (await app(() => document.querySelector('.preview-content pre > code.language-testblock') === null)) === true);

console.log("— an UNREGISTERED language (```js) is left untouched (still a <pre><code>) —");
ok("the ```js block is still a rendered <pre><code class='language-js'> (not replaced)", (await app(() => document.querySelector('.preview-content pre > code.language-js') !== null)) === true);

console.log("— a SYNC-throwing handler does NOT skip sibling blocks of the same lang (review MINOR) —");
await app(() => {
  window.__throwDispose = window.__geodeRegisterMarkdownCodeBlockProcessor("throwblock", () => { throw new Error("boom"); });
});
await app(async () => {
  try { await window.__app.vault.create("cbthrow.md", "```throwblock\nfirst\n```\n\n```throwblock\nsecond\n```\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("cbthrow.md");
  const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "preview");
});
await page.waitForSelector(".preview-content", { state: "attached", timeout: 5000 });
await app(() => new Promise((r) => setTimeout(r, 300)));
ok("BOTH ```throwblock blocks were replaced despite a sync throw (no raw <pre> left)", (await app(() => document.querySelectorAll('.preview-content pre > code.language-throwblock').length)) === 0, JSON.stringify(await app(() => document.querySelectorAll('.preview-content pre > code.language-throwblock').length)));
await app(() => window.__throwDispose());

console.log("— disposer: after unregister, a fresh render does NOT replace the block —");
await app(() => window.__cbDispose());
await app(async () => {
  try { await window.__app.vault.create("cb2.md", "# H2\n\n```testblock\nfresh source\n```\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("cb2.md");
  const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "preview");
});
await page.waitForSelector(".preview-content", { state: "attached", timeout: 5000 });
await app(() => new Promise((r) => setTimeout(r, 300)));
ok("disposed processor does NOT replace the block (```testblock still a <pre><code>)", (await app(() => document.querySelector('.preview-content pre > code.language-testblock') !== null)) === true);
ok("no .cb-rendered div on the fresh render (processor disposed)", (await app(() => document.querySelector(".preview-content .cb-rendered") === null)) === true);

console.log(`\nR133 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
