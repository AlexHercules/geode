/**
 * R116 compat MarkdownView.getMode / getViewData E2E — browser mode :1420.
 * Run: node .calibration/r116-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 116 additions" (compat 商业主轴).
 *
 * Obsidian MarkdownView.getMode(): "source" (editor — live OR source) | "preview" (reading);
 * getViewData(): the editor's raw markdown source. A Geode compat MarkdownView is built only over
 * an ACTIVE editor (getActiveView non-null), so getMode() reports "source" in both editing modes,
 * and the active MarkdownView is null in reading view (Geode reading view is not CM-backed).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r116", name: "r116", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const CONTENT = "# ext1\nalpha\nbeta\n";
await app(async (c) => { try { await window.__app.vault.create("ext1.md", c); } catch { /* exists */ } }, CONTENT);
await app(() => {
  window.__app.workspace.openFile("ext1.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.app.workspace.activeLeaf?.view, null, { timeout: 5000 });

// mv() = a FRESH compat MarkdownView over the active editor (or null)
const mode = () => app(() => window.app.workspace.activeLeaf.view?.getMode() ?? null);
const data = () => app(() => window.app.workspace.activeLeaf.view?.getViewData() ?? null);
const viewNull = () => app(() => window.app.workspace.activeLeaf.view === null);

console.log("— live mode —");
ok("active MarkdownView exists in live mode", !(await viewNull()));
ok("getMode() → 'source' in live mode", (await mode()) === "source");
ok("getViewData() returns the editor's raw markdown source", (await data()) === CONTENT, JSON.stringify(await data()));

console.log("— getViewData reflects a live edit —");
await app(() => {
  const v = window.__app.documents.getActiveView().view;
  v.dispatch({ changes: { from: v.state.doc.length, insert: "GAMMA_EDIT\n" }, userEvent: "input" });
});
ok("getViewData() picks up the new editor content (live read)", (await data()).includes("GAMMA_EDIT"), JSON.stringify(await data()));
ok("getViewData() equals the underlying CM doc", (await data()) === (await app(() => window.__app.documents.getActiveView().view.state.doc.toString())));

console.log("— source mode (editing) still reports 'source' —");
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "source"); });
await page.waitForFunction(() => !!window.app.workspace.activeLeaf?.view, null, { timeout: 3000 }).catch(() => {});
ok("getMode() → 'source' in source mode (Obsidian merges live+source)", (await mode()) === "source");
ok("getViewData() still returns the source in source mode", (await data())?.includes("GAMMA_EDIT"));

console.log("— preview (reading) mode: no CM-backed MarkdownView —");
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "preview"); });
await page.waitForFunction(() => window.app.workspace.activeLeaf.view === null, null, { timeout: 3000 }).catch(() => {});
ok("active MarkdownView is null in reading view (documented divergence)", await viewNull());

console.log("— back to live restores the view —");
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "live"); });
await page.waitForFunction(() => !!window.app.workspace.activeLeaf?.view, null, { timeout: 3000 }).catch(() => {});
ok("getMode() → 'source' again after returning to live", (await mode()) === "source");

console.log(`\nR116 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
