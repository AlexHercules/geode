/**
 * R153 editor "Auto pair brackets" toggle E2E — browser mode :1420.
 * Run: node .calibration/r153-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 153 additions".
 *
 * Obsidian's "Auto pair brackets" (default ON) auto-closes ( [ { " ' while typing. Geode had
 * closeBrackets() always on; R153 puts it in a CM compartment behind a persisted setting toggle.
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
await page.evaluate(() => { try { localStorage.removeItem("geode.autoPairBrackets"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r153", name: "r153", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// open an empty note in live mode + focus the CM editor
await app(() => window.__app.vault.create("r153.md", "\n"));
await app(async () => {
  window.__app.workspace.openFile("r153.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await page.waitForFunction(() => !!window.__app.documents.getActiveView()?.view, null, { timeout: 4000 });

// reset the doc to empty + cursor at 0, then type one "(" and read the result
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
// toggle the setting via the Settings UI (Appearance section), then return to the editor
const toggleAutoPair = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-editor"]');
  await new Promise((r) => setTimeout(r, 80));
  await page.waitForSelector("[data-testid=settings-autopair-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-autopair-toggle]");
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await page.click(".cm-content");
  await wait(40);
};

console.log("— default ON: typing a bracket auto-closes it —");
ok("typing '(' yields '()' (auto-paired, default ON)", (await typeOpenParen()) === "()");
ok("typing '[' also auto-pairs → '[]'", await (async () => {
  await app(() => { const v = window.__app.documents.getActiveView().view; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "" }, selection: { anchor: 0 } }); v.focus(); });
  await wait(40); await page.keyboard.type("["); await wait(60);
  return (await app(() => window.__app.documents.getActiveView().view.state.doc.toString())) === "[]";
})());

console.log("— toggle OFF: typing a bracket does NOT auto-close —");
await toggleAutoPair();
ok("the toggle is now off (aria-checked false)", await app(async () => {
  window.__app.workspace.openModal("settings");
  await new Promise((r) => setTimeout(r, 80));
  document.querySelector('[data-testid="settings-nav-editor"]')?.click();
  await new Promise((r) => setTimeout(r, 80));
  const v = document.querySelector("[data-testid=settings-autopair-toggle]")?.getAttribute("aria-checked");
  window.__app.workspace.closeModal();
  return v;
}) === "false");
await page.click(".cm-content");
await wait(40);
ok("typing '(' yields just '(' (no auto-pair)", (await typeOpenParen()) === "(");
ok("the pref persisted to localStorage as 'false'", (await app(() => localStorage.getItem("geode.autoPairBrackets"))) === "false");

console.log("— toggle back ON: auto-pair restored —");
await toggleAutoPair();
ok("typing '(' yields '()' again (auto-pair restored)", (await typeOpenParen()) === "()");

console.log("— the pref survives a reload (persisted) —");
await toggleAutoPair(); // OFF again, then reload
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r153b", name: "r153b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await app(async () => {
  try { await window.__app.vault.create("r153.md", "\n"); } catch { /* exists */ } // memory vault reset on reload
  window.__app.workspace.openFile("r153.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await page.waitForFunction(() => !!window.__app.documents.getActiveView()?.view, null, { timeout: 4000 });
ok("after reload the OFF pref is honored (typing '(' → '(')", (await typeOpenParen()) === "(");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR153 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
