/**
 * R115 compat Plugin.registerEditorExtension E2E — browser mode :1420.
 * Run: node .calibration/r115-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 115 additions" (compat 商业主轴).
 *
 * A plugin-registered CM6 extension applies to EVERY markdown editor (Obsidian semantics).
 * Bridge: compat Plugin.registerEditorExtension → core editorExtensions registry → EditorPane
 * reconfigures each view's compat compartment on editorExtensionsRevision. The __geodeRegister-
 * EditorExtension probe registers a marker editorAttributes extension (adds data-r115 to .cm-editor).
 * Data-safety: an active plugin extension must NOT break the autosave pipeline.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r115", name: "r115", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && typeof window.__geodeRegisterEditorExtension === "function", null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// create + open a note in live mode (a CM view exists)
await app(async () => {
  for (const p of ["ext1.md", "ext2.md"]) { try { await window.__app.vault.create(p, "# " + p + "\nbody\n"); } catch { /* exists */ } }
});
await app(() => {
  window.__app.workspace.openFile("ext1.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView()?.view, null, { timeout: 5000 });

const attr = () => app(() => window.__app.documents.getActiveView()?.view?.dom?.getAttribute("data-r115") ?? null);

console.log("— extension reaches the already-open view —");
ok("before register: no marker attribute on .cm-editor", (await attr()) === null);
await app(() => { window.__r115dispose = window.__geodeRegisterEditorExtension("data-r115", "on"); });
await page.waitForFunction(() => window.__app.documents.getActiveView()?.view?.dom?.getAttribute("data-r115") === "on", null, { timeout: 3000 }).catch(() => {});
ok("after register: the OPEN view picked up the extension (reconfigure)", (await attr()) === "on");

console.log("— extension reaches a NEW view (seeded from registry) —");
await app(() => {
  window.__app.workspace.openFile("ext2.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => {
  const v = window.__app.documents.getActiveView()?.view;
  return v && v.state.doc.toString().includes("ext2");
}, null, { timeout: 5000 });
ok("a newly-opened editor view also has the extension (build-time seed)", (await attr()) === "on");

console.log("— data safety: editing + autosave still work with the extension active —");
const saved = await app(async () => {
  const v = window.__app.documents.getActiveView().view;
  v.dispatch({ changes: { from: v.state.doc.length, insert: "\nR115_EDIT" }, userEvent: "input" });
  for (let i = 0; i < 50; i++) {
    const disk = await window.__app.vault.read("ext2.md");
    if (disk.includes("R115_EDIT")) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
});
ok("a typed edit autosaves to disk (extension does not break the save pipeline)", saved);
ok("doc still contains the edit in the view", (await app(() => window.__app.documents.getActiveView().view.state.doc.toString().includes("R115_EDIT"))));

console.log("— unregister removes the extension from open views —");
await app(() => { window.__r115dispose(); });
await page.waitForFunction(() => window.__app.documents.getActiveView()?.view?.dom?.getAttribute("data-r115") === null, null, { timeout: 3000 }).catch(() => {});
ok("after dispose: the marker attribute is gone (reconfigure on revision)", (await attr()) === null);
ok("dispose is idempotent (second call no-throw)", await app(() => { try { window.__r115dispose(); return true; } catch { return false; } }));

console.log(`\nR115 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
