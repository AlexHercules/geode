/**
 * R117 compat Workspace.activeEditor E2E — browser mode :1420.
 * Run: node .calibration/r117-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 117 additions" (compat 商业主轴).
 *
 * Obsidian `workspace.activeEditor: MarkdownFileInfo | null` — the active markdown editor's info
 * (editor + file + app). A compat MarkdownView IS a MarkdownFileInfo; the modern API plugins prefer
 * over getActiveViewOfType(MarkdownView). Live getter; null in reading view (Geode reading view is
 * not CM-backed → no active editor, same divergence as R116).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r117", name: "r117", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const C1 = "# one\nalpha\n";
const C2 = "# two\nbeta\n";
await app(async (cs) => {
  try { await window.__app.vault.create("one.md", cs[0]); } catch { /* exists */ }
  try { await window.__app.vault.create("two.md", cs[1]); } catch { /* exists */ }
}, [C1, C2]);
await app(() => {
  window.__app.workspace.openFile("one.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => window.app.workspace.activeEditor !== null, null, { timeout: 5000 });

console.log("— activeEditor in live mode (MarkdownFileInfo shape) —");
ok("activeEditor is non-null over an active editor", await app(() => window.app.workspace.activeEditor !== null));
ok("activeEditor.editor exists + getValue() returns the source", await app(() => {
  const ed = window.app.workspace.activeEditor?.editor;
  return !!ed && typeof ed.getValue === "function" && ed.getValue().includes("alpha");
}));
ok("activeEditor.file is the active TFile (path = one.md)", await app(() => window.app.workspace.activeEditor?.file?.path === "one.md"));
ok("activeEditor.app is the compat App (=== window.app)", await app(() => window.app.workspace.activeEditor?.app === window.app));

console.log("— activeEditor is live (tracks the active file) —");
await app(() => {
  window.__app.workspace.openFile("two.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => window.app.workspace.activeEditor?.file?.path === "two.md", null, { timeout: 5000 }).catch(() => {});
ok("after switching files, activeEditor.file follows the active editor", await app(() => window.app.workspace.activeEditor?.file?.path === "two.md"));
ok("activeEditor.editor.getValue() reflects the new file's content", await app(() => window.app.workspace.activeEditor?.editor?.getValue().includes("beta")));

console.log("— activeEditor matches getActiveViewOfType(MarkdownView) editor —");
ok("activeEditor and activeLeaf.view wrap the same file", await app(() => window.app.workspace.activeEditor?.file?.path === window.app.workspace.activeLeaf?.view?.file?.path));

console.log("— reading view: activeEditor is null (no editor) —");
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "preview"); });
await page.waitForFunction(() => window.app.workspace.activeEditor === null, null, { timeout: 3000 }).catch(() => {});
ok("activeEditor is null in reading view (documented divergence)", await app(() => window.app.workspace.activeEditor === null));

console.log("— back to live restores activeEditor —");
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "live"); });
await page.waitForFunction(() => window.app.workspace.activeEditor !== null, null, { timeout: 3000 }).catch(() => {});
ok("activeEditor non-null again after returning to live", await app(() => window.app.workspace.activeEditor !== null));

console.log(`\nR117 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
