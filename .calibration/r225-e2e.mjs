/**
 * R225 editor "Auto pair Markdown syntax" toggle E2E — browser mode :1420.
 * Run: node .calibration/r225-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 225 additions".
 *
 * Obsidian's "Auto pair Markdown syntax" (default ON) wraps a selection with emphasis marks
 * (* _ ~ = $ `) when you type one. Geode had R35's markdownWrapHandler always on; R225 puts it
 * in a CM compartment behind a persisted setting toggle (orthogonal to R153 "Auto pair brackets").
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
await page.evaluate(() => { try { localStorage.removeItem("geode.autoPairMarkdown"); localStorage.removeItem("geode.autoPairBrackets"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r225", name: "r225", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const openEditor = async () => {
  await app(async () => {
    try { await window.__app.vault.create("r225.md", "\n"); } catch { /* exists (memory vault reset on reload) */ }
    window.__app.workspace.openFile("r225.md");
    const tab = window.__app.workspace.getActiveTab();
    window.__app.workspace.setTabMode(tab.id, "live");
  });
  await page.waitForSelector(".cm-content", { timeout: 4000 });
  await page.click(".cm-content");
  await page.waitForFunction(() => !!window.__app.documents.getActiveView()?.view, null, { timeout: 4000 });
};
await openEditor();

// seed doc with "hello", select it, type one mark char, read the resulting doc
const wrapSel = async (ch) => {
  await app(() => {
    const v = window.__app.documents.getActiveView().view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "hello" }, selection: { anchor: 0, head: 5 } });
    v.focus();
  });
  await wait(40);
  await page.keyboard.type(ch);
  await wait(60);
  return app(() => window.__app.documents.getActiveView().view.state.doc.toString());
};
// empty-selection bracket type → tests R153 orthogonality
const typeOpenParen = async () => {
  await app(() => {
    const v = window.__app.documents.getActiveView().view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "" }, selection: { anchor: 0 } });
    v.focus();
  });
  await wait(40);
  await page.keyboard.type("(");
  await wait(60);
  return app(() => window.__app.documents.getActiveView().view.state.doc.toString());
};
const toggleMd = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-editor"]');
  await wait(80);
  await page.waitForSelector("[data-testid=settings-autopair-markdown-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-autopair-markdown-toggle]");
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await page.click(".cm-content");
  await wait(40);
};

console.log("— default ON: typing a mark char wraps the selection —");
ok("'*' wraps selection → '*hello*'", (await wrapSel("*")) === "*hello*", await wrapSel("*"));
ok("'`' wraps selection → '`hello`'", (await wrapSel("`")) === "`hello`");
ok("'_' wraps selection → '_hello_'", (await wrapSel("_")) === "_hello_");

console.log("— toggle OFF: typing a mark char REPLACES the selection (no wrap) —");
await toggleMd();
ok("the toggle is now off (aria-checked false)", await app(async () => {
  window.__app.workspace.openModal("settings");
  await new Promise((r) => setTimeout(r, 80));
  document.querySelector('[data-testid="settings-nav-editor"]')?.click();
  await new Promise((r) => setTimeout(r, 80));
  const v = document.querySelector("[data-testid=settings-autopair-markdown-toggle]")?.getAttribute("aria-checked");
  window.__app.workspace.closeModal();
  return v;
}) === "false");
await page.click(".cm-content");
await wait(40);
ok("'*' over a selection → just '*' (no wrap)", (await wrapSel("*")) === "*", await wrapSel("*"));
ok("ORTHOGONAL: auto-pair brackets still works → '(' → '()'", (await typeOpenParen()) === "()");
ok("the pref persisted to localStorage as 'false'", (await app(() => localStorage.getItem("geode.autoPairMarkdown"))) === "false");

console.log("— toggle back ON: wrap restored —");
await toggleMd();
ok("'*' wraps again → '*hello*'", (await wrapSel("*")) === "*hello*");

console.log("— the pref survives a reload (persisted) —");
await toggleMd(); // OFF again, then reload
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r225b", name: "r225b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openEditor();
ok("after reload the OFF pref is honored ('*' over selection → '*')", (await wrapSel("*")) === "*");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR225 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
