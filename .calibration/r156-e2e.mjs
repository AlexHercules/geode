/**
 * R156 "Fold heading" toggle E2E — browser mode :1420.
 * Run: node .calibration/r156-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 156 additions".
 *
 * Obsidian's "Fold heading" Editor setting (default ON) gates whether the editor offers fold
 * points for heading sections. R156 gates the heading branch of markdownFoldRange behind a
 * foldService Compartment that EditorPane reconfigures. (Sibling "Fold indent" is deferred —
 * CM's foldable() falls back to built-in syntaxFolding for multi-line blocks; see the contract.)
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
await page.evaluate(() => { try { localStorage.removeItem("geode.foldHeading"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r156", name: "r156", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a multi-line list item (line 1) followed by a foldable heading section (line 4). The list is
// here to prove the toggle is heading-specific: it must keep folding when Fold heading is OFF.
const DOC = "- parent list item\n  nested child line\n\n# Section Heading\nbody under the heading\n";
const LIST_LINE = 1;
const HEADING_LINE = 4;
const openDoc = async () => {
  await app(async (doc) => {
    try { await window.__app.vault.create("r156.md", doc); } catch {}
    window.__app.workspace.openFile("r156.md");
    const tab = window.__app.workspace.getActiveTab();
    window.__app.workspace.setTabMode(tab.id, "live");
    await new Promise((r) => setTimeout(r, 220));
  }, DOC);
  await page.waitForSelector(".cm-content", { timeout: 4000 });
  await page.click(".cm-content");
  await page.waitForFunction(() => !!window.__app.documents.getActiveView()?.view, null, { timeout: 4000 });
  await wait(60);
};
const placeholders = () => page.locator(".cm-foldPlaceholder").count();
// open (foldable, not-yet-folded) fold chevrons in the gutter — recomputed when the foldService
// reconfigures (R156 foldingChanged fix); a stale chevron would keep showing after toggling OFF
const chevrons = () => app(() => document.querySelectorAll(".cm-foldGutter .cm-fold-marker:not(.is-folded)").length);
const toggleFoldAtLine = async (lineNo) => {
  await app((n) => {
    const v = window.__app.documents.getActiveView().view;
    v.dispatch({ selection: { anchor: v.state.doc.line(n).from } });
    v.focus();
  }, lineNo);
  await wait(40);
  await app(() => window.__app.commands.execute("editor:toggle-fold"));
  await wait(120);
};
const toggleSetting = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-editor"]');
  await new Promise((r) => setTimeout(r, 80));
  await page.waitForSelector("[data-testid=settings-fold-heading-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-fold-heading-toggle]");
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await page.click(".cm-content");
  await wait(80);
};

await openDoc();

console.log("— default ON: a heading section folds —");
ok("no fold placeholder initially", (await placeholders()) === 0);
await toggleFoldAtLine(HEADING_LINE);
ok("default ON: folding the heading collapses its section", (await placeholders()) === 1, `ph=${await placeholders()}`);
await toggleFoldAtLine(HEADING_LINE); // unfold
ok("heading unfolds again", (await placeholders()) === 0);

console.log("— default ON: gutter offers a chevron for both the heading and the list —");
ok("default ON: 2 open fold chevrons (heading + list)", (await chevrons()) === 2, `chev=${await chevrons()}`);

console.log("— Fold heading OFF: heading no longer folds, but lists still do —");
await toggleSetting();
ok("Fold heading OFF: the heading's gutter chevron is gone (no stale marker)", (await chevrons()) === 1, `chev=${await chevrons()}`);
await toggleFoldAtLine(HEADING_LINE);
ok("Fold heading OFF: heading is not foldable (no placeholder)", (await placeholders()) === 0, `ph=${await placeholders()}`);
await toggleFoldAtLine(LIST_LINE);
ok("Fold heading OFF: a list item still folds (toggle is heading-specific)", (await placeholders()) === 1, `ph=${await placeholders()}`);
await toggleFoldAtLine(LIST_LINE); // unfold
ok("list unfolds", (await placeholders()) === 0);
ok("geode.foldHeading persisted as 'false'", (await app(() => localStorage.getItem("geode.foldHeading"))) === "false");
ok("the toggle reads off (aria-checked false)", await app(async () => {
  window.__app.workspace.openModal("settings");
  await new Promise((r) => setTimeout(r, 80));
  document.querySelector('[data-testid="settings-nav-editor"]')?.click();
  await new Promise((r) => setTimeout(r, 80));
  const v = document.querySelector("[data-testid=settings-fold-heading-toggle]")?.getAttribute("aria-checked");
  window.__app.workspace.closeModal();
  return v;
}) === "false");
await page.click(".cm-content");
await wait(60);

console.log("— toggle back ON: heading folds again —");
await toggleSetting();
await toggleFoldAtLine(HEADING_LINE);
ok("Fold heading ON again: heading folds", (await placeholders()) === 1, `ph=${await placeholders()}`);
await toggleFoldAtLine(HEADING_LINE); // unfold
ok("heading unfolds", (await placeholders()) === 0);

console.log("— Fold heading OFF survives a reload —");
await toggleSetting(); // OFF again, then reload
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r156b", name: "r156b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openDoc(); // memory vault resets on reload — recreate
await toggleFoldAtLine(HEADING_LINE);
ok("after reload, Fold heading OFF is honored (heading not foldable)", (await placeholders()) === 0, `ph=${await placeholders()}`);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR156 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
