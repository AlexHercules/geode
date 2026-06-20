/**
 * R123 compat MarkdownView.setViewData E2E — browser mode :1420.
 * Run: node .calibration/r123-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 123 additions" (compat 商业主轴).
 *
 * Obsidian MarkdownView.setViewData(data, clear): void — replace the editor's full content. Geode
 * routes through editor.setValue → ONE undoable CM transaction → the doc-change listener → autosave,
 * so the replacement persists on the normal save cycle. DATA-SAFETY: the new content must actually
 * reach disk (not be lost), and a shorter replacement must leave NO leftover. `clear` is ignored.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r123", name: "r123", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
await app(async () => { try { await window.__app.vault.create("sv.md", "# original\nold body\nold tail\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("sv.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.app.workspace.activeLeaf?.view?.setViewData, null, { timeout: 5000 });

const NEW = "# replaced\nbrand new content\n";

console.log("— setViewData replaces the editor content —");
const replaced = await app((data) => {
  const mv = window.app.workspace.activeLeaf.view;
  mv.setViewData(data);
  return { viewData: mv.getViewData(), cmDoc: window.__app.documents.getActiveView().view.state.doc.toString() };
}, NEW);
ok("getViewData() returns the new content after setViewData", replaced.viewData === NEW, JSON.stringify(replaced.viewData));
ok("the underlying CM doc is the new content (full replace, no leftover)", replaced.cmDoc === NEW, JSON.stringify(replaced.cmDoc));

console.log("— data safety: the replacement autosaves to disk —");
const persisted = await app(async (data) => {
  for (let i = 0; i < 60; i++) {
    const disk = await window.__app.vault.read("sv.md");
    if (disk === data) return disk;
    await new Promise((r) => setTimeout(r, 60));
  }
  return await window.__app.vault.read("sv.md");
}, NEW);
ok("vault.read reflects the new content (setViewData persisted — no data loss)", persisted === NEW, JSON.stringify(persisted));

console.log("— a SHORTER replacement leaves no leftover —");
const shrunk = await app(async () => {
  const mv = window.app.workspace.activeLeaf.view;
  mv.setViewData("x\n");
  for (let i = 0; i < 60; i++) {
    const disk = await window.__app.vault.read("sv.md");
    if (disk === "x\n") break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return { view: mv.getViewData(), disk: await window.__app.vault.read("sv.md") };
});
ok("shrinking via setViewData replaces fully (view === 'x\\n')", shrunk.view === "x\n", JSON.stringify(shrunk.view));
ok("the shrunk content persists exactly (disk === 'x\\n', no leftover bytes)", shrunk.disk === "x\n", JSON.stringify(shrunk.disk));

console.log("— clear=true is accepted (ignored, same behavior) —");
const cleared = await app(() => {
  const mv = window.app.workspace.activeLeaf.view;
  mv.setViewData("with clear flag\n", true);
  return mv.getViewData();
});
ok("setViewData(data, true) replaces content (clear flag ignored, no throw)", cleared === "with clear flag\n", JSON.stringify(cleared));

console.log("— still editable after setViewData (normal edit path) —");
const editable = await app(async () => {
  const v = window.__app.documents.getActiveView().view;
  v.dispatch({ changes: { from: v.state.doc.length, insert: "USER_EDIT" }, userEvent: "input" });
  for (let i = 0; i < 50; i++) {
    const disk = await window.__app.vault.read("sv.md");
    if (disk.includes("USER_EDIT")) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
});
ok("a user edit after setViewData still autosaves (setViewData didn't break the edit path)", editable);

console.log(`\nR123 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
