/**
 * R134 live-preview plugin code blocks E2E — browser mode :1420.
 * Run: node .calibration/r134-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 134 additions".
 *
 * registerMarkdownCodeBlockProcessor(lang, (body, el, ctx) => …) now renders the fence as a LIVE
 * widget in the editor (not just reading view): a registered ```<lang> fence the cursor is outside
 * becomes a non-editable widget filled by the handler; cursor/click into it reveals the source; an
 * unregistered lang stays raw; the document bytes are never modified; registering/disposing while a
 * note is open re-renders via the codeBlockProcessorsRevision → modeCompartment reconfigure.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r134", name: "r134", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && typeof window.__geodeRegisterMarkdownCodeBlockProcessor === "function", null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cbTestblock = () => page.locator('[data-testid="cm-live-codeblock"].cm-live-codeblock-testblock').count();
const cbLater = () => page.locator('.cm-live-codeblock-laterblock').count();
const cbJs = () => page.locator('.cm-live-codeblock-js').count();
const selectAt = (n) => app(([a]) => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: a } }); }, [n]);

const DOC = "# Heading\n\n```testblock\nline one\nline two\n```\n\n```js\nconst x = 1;\n```\n\n```laterblock\ndeferred\n```\n\nafter\n";
const SRC = "live-cb.md";

// register ```testblock BEFORE opening — the fresh editor mount picks up the registry (deterministic)
await app(() => {
  window.__live = { body: null, path: null, isDiv: false, frontmatter: "unset" };
  window.__tbDispose = window.__geodeRegisterMarkdownCodeBlockProcessor("testblock", (body, el, ctx) => {
    window.__live.body = body;
    window.__live.path = ctx && ctx.sourcePath;
    window.__live.isDiv = el.tagName === "DIV";
    window.__live.frontmatter = ctx ? ctx.frontmatter : "noctx";
    el.setAttribute("data-cb", "rendered");
    el.appendChild(Object.assign(document.createElement("span"), { className: "cb-out", textContent: "LIVE:" + body }));
  });
});

await app(async ([p, d]) => { try { await window.__app.vault.create(p, d); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, [SRC, DOC]);
await app(async ([p]) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, [SRC]);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await wait(60);
await selectAt(0); // cursor in the heading — outside every fence
await wait(200);

console.log("— a registered ```testblock fence renders as a live widget (cursor outside) —");
ok("the ```testblock fence is a cm-live-codeblock widget", (await cbTestblock()) === 1, `n=${await cbTestblock()}`);
ok("the handler filled the widget div (data-cb=rendered)", await app(() => !!document.querySelector('.cm-live-codeblock-testblock[data-cb="rendered"]')));
ok("the widget shows the handler output", (await app(() => document.querySelector('.cm-live-codeblock-testblock .cb-out')?.textContent ?? null)) === "LIVE:line one\nline two");
const live = await app(() => ({ ...window.__live }));
ok("handler received body = inner fence text (no fences, no trailing \\n)", live.body === "line one\nline two", JSON.stringify(live.body));
ok("handler received ctx.sourcePath === the note path", live.path === SRC, JSON.stringify(live.path));
ok("handler received a fresh <div> el", live.isDiv === true);
ok("ctx.frontmatter is null for a note without frontmatter (not undefined)", live.frontmatter === null, JSON.stringify(live.frontmatter));

console.log("— an UNREGISTERED lang (```js) is NOT a widget (stays raw source) —");
ok("no cm-live-codeblock widget for the ```js fence", (await cbJs()) === 0, `n=${await cbJs()}`);
ok("the ```js source is still visible in the editor", (await app(() => document.querySelector(".cm-content")?.textContent ?? "")).includes("const x = 1;"));

console.log("— register a 2nd lang while the note is OPEN → it lights up (revision reconfigure) —");
ok("```laterblock is NOT yet a widget (unregistered)", (await cbLater()) === 0, `n=${await cbLater()}`);
await app(() => {
  window.__laterDispose = window.__geodeRegisterMarkdownCodeBlockProcessor("laterblock", (body, el) => {
    el.appendChild(Object.assign(document.createElement("span"), { className: "later-out", textContent: "L2:" + body }));
  });
});
await wait(250);
ok("```laterblock becomes a widget after registering while open (reconfigure)", (await cbLater()) === 1, `n=${await cbLater()}`);
ok("the laterblock handler ran (L2 output)", (await app(() => document.querySelector('.cm-live-codeblock-laterblock .later-out')?.textContent ?? null)) === "L2:deferred");

console.log("— cursor INTO the fence reveals the source; back out re-renders —");
const tbFrom = await app(([p]) => (window.__app.documents.get(p)?.getText() ?? "").indexOf("```testblock"), [SRC]);
await selectAt(tbFrom + 5);
await wait(200);
ok("cursor inside the testblock fence reveals the source (widget gone)", (await cbTestblock()) === 0, `n=${await cbTestblock()}`);
ok("raw ```testblock source is visible while editing", (await app(() => document.querySelector(".cm-content")?.textContent ?? "")).includes("line one"));
await selectAt(0);
await wait(200);
ok("widget reappears when the cursor leaves the fence", (await cbTestblock()) === 1, `n=${await cbTestblock()}`);

console.log("— the document bytes are never modified by live rendering —");
ok("doc bytes unchanged after render/reveal cycles", (await app(([p]) => window.__app.documents.get(p)?.getText() ?? "", [SRC])) === DOC, "DOC MUTATED");

console.log("— disposer: unregister testblock → its widget reverts to source (reconfigure) —");
await app(() => window.__tbDispose());
await wait(250);
ok("disposed lang is no longer a widget", (await cbTestblock()) === 0, `n=${await cbTestblock()}`);
ok("the disposed fence's raw source is back", (await app(() => document.querySelector(".cm-content")?.textContent ?? "")).includes("```testblock"));
ok("the still-registered laterblock widget is unaffected by disposing testblock", (await cbLater()) === 1, `n=${await cbLater()}`);

console.log("— review fix 1: a plugin registering a BUILT-IN fence lang (mermaid) does NOT double-render —");
await app(() => { window.__mmDispose = window.__geodeRegisterMarkdownCodeBlockProcessor("mermaid", (_b, el) => el.setAttribute("data-plugin-mermaid", "ran")); });
await app(async ([p]) => {
  try { await window.__app.vault.create(p, "# M\n\n```mermaid\ngraph TD\nA-->B\n```\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, ["cb-mermaid.md"]);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await wait(60);
await selectAt(0);
await wait(200);
ok("the ```mermaid fence still renders via the built-in liveMermaid widget", (await page.locator('[data-testid="cm-live-mermaid"]').count()) === 1, `n=${await page.locator('[data-testid="cm-live-mermaid"]').count()}`);
ok("livePluginCodeBlocks did NOT also grab the built-in mermaid lang (no double decoration)", (await page.locator('.cm-live-codeblock-mermaid').count()) === 0, `n=${await page.locator('.cm-live-codeblock-mermaid').count()}`);
await app(() => window.__mmDispose());

console.log("— review fix 2: an unclosed ~~~ fence whose last line is ``` keeps it in the handler body —");
await app(() => { window.__wrap = { body: null }; window.__wrapDispose = window.__geodeRegisterMarkdownCodeBlockProcessor("wrapblock", (body, el) => { window.__wrap.body = body; el.setAttribute("data-wrap", "ran"); }); });
await app(async ([p, d]) => {
  try { await window.__app.vault.create(p, d); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, ["cb-unclosed.md", "# H\n\n~~~wrapblock\nkeep this\n```\n"]);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await wait(60);
await selectAt(0);
await wait(200);
ok("the unclosed ~~~wrapblock fence rendered (handler ran)", await app(() => !!document.querySelector('[data-wrap="ran"]')));
const wrapBody = await app(() => window.__wrap.body);
ok("body keeps the opposite-marker ``` line (not stripped as a closing fence) + content", typeof wrapBody === "string" && wrapBody.includes("```") && wrapBody.includes("keep this"), JSON.stringify(wrapBody));
await app(() => window.__wrapDispose());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR134 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
