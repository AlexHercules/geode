/**
 * R232 editor "Smart lists" toggle E2E — browser mode :1420.
 * Run: node .calibration/r232-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 232 additions".
 *
 * Obsidian's "Smart lists" (智能列表, default ON): pressing Enter inside a list continues/
 * renumbers/outdents the list markup. Geode had @codemirror/lang-markdown's markdownKeymap
 * always on (bundled inside markdown()); R232 moves it into a CM compartment behind a persisted
 * toggle (mirrors R225 autoPairMarkdown). NB: lang-markdown couples list + blockquote continuation
 * (+ Backspace dedent) in that one keymap, so OFF disables all of them — this suite asserts the
 * list gate and documents the blockquote coupling.
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
await page.evaluate(() => { try { localStorage.removeItem("geode.smartLists"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r232", name: "r232", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const secondLine = (doc) => (doc.split("\n")[1] ?? "");

const openEditor = async () => {
  await app(async () => {
    try { await window.__app.vault.create("r232.md", "\n"); } catch { /* exists (memory vault reset on reload) */ }
    window.__app.workspace.openFile("r232.md");
    const tab = window.__app.workspace.getActiveTab();
    window.__app.workspace.setTabMode(tab.id, "source");
  });
  await page.waitForSelector(".cm-content", { timeout: 4000 });
  await page.click(".cm-content");
  await page.waitForFunction(() => !!window.__app.documents.getActiveView()?.view, null, { timeout: 4000 });
};
await openEditor();

// seed the doc with one list/quote line, cursor at end, press Enter, read the resulting doc
const listEnter = async (seed) => {
  await app((s) => {
    const v = window.__app.documents.getActiveView().view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: s }, selection: { anchor: s.length } });
    v.focus();
  }, seed);
  await wait(40);
  await page.keyboard.press("Enter");
  await wait(60);
  return app(() => window.__app.documents.getActiveView().view.state.doc.toString());
};
const toggleSmart = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-editor"]');
  await wait(80);
  await page.waitForSelector("[data-testid=settings-smart-lists-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-smart-lists-toggle]");
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await page.click(".cm-content");
  await wait(40);
};

console.log("— there is a Smart lists toggle in editor settings, default ON —");
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-editor"]');
await page.waitForSelector("[data-testid=settings-smart-lists-toggle]", { timeout: 3000 });
ok("'Smart lists' toggle defaults ON", (await app(() => document.querySelector('[data-testid="settings-smart-lists-toggle"]')?.getAttribute("aria-checked"))) === "true");
await app(() => window.__app.workspace.closeModal());
await page.click(".cm-content");
await wait(40);

console.log("— default ON: Enter continues / renumbers / continues a quote —");
ok("bullet '- foo' + Enter → next line starts '- '", secondLine(await listEnter("- foo")).startsWith("- "));
ok("ordered '1. foo' + Enter → next line starts '2. ' (renumber)", secondLine(await listEnter("1. foo")).startsWith("2. "));
ok("quote '> foo' + Enter → next line starts '> ' (bundled blockquote continuation)", secondLine(await listEnter("> foo")).startsWith("> "));

console.log("— toggle OFF: Enter no longer continues the list marker —");
await toggleSmart();
ok("the toggle is now off (aria-checked false)", await app(async () => {
  window.__app.workspace.openModal("settings");
  await new Promise((r) => setTimeout(r, 80));
  document.querySelector('[data-testid="settings-nav-editor"]')?.click();
  await new Promise((r) => setTimeout(r, 80));
  const v = document.querySelector("[data-testid=settings-smart-lists-toggle]")?.getAttribute("aria-checked");
  window.__app.workspace.closeModal();
  return v;
}) === "false");
await page.click(".cm-content");
await wait(40);
ok("OFF: '- foo' + Enter → next line does NOT start with '-' (plain newline)", !secondLine(await listEnter("- foo")).startsWith("-"));
ok("the pref persisted to localStorage as 'false'", (await app(() => localStorage.getItem("geode.smartLists"))) === "false");

console.log("— toggle back ON: continuation restored —");
await toggleSmart();
ok("ON again: '- foo' + Enter → next line starts '- '", secondLine(await listEnter("- foo")).startsWith("- "));

console.log("— the pref survives a reload (persisted) —");
await toggleSmart(); // OFF again, then reload
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r232b", name: "r232b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openEditor();
ok("after reload the OFF pref is honored ('- foo' + Enter → no '-' continuation)", !secondLine(await listEnter("- foo")).startsWith("-"));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR232 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
