/**
 * R220 (F2) RUNTIME check — the type-aligned compat Editor methods accept their new
 * d.ts-shaped args at runtime (the pure type surface is proven by r220-types.ts +
 * .calibration/tsconfig.r220.json). Here: getDoc() returns the editor; the extra
 * (ignored) params on replaceSelection(text, origin) / setSelections(ranges, main)
 * don't break the call. Writes dispatch through CM (same path as R128). Browser :1420.
 *   Run: node .calibration/r220-e2e.mjs
 * Contract: ARCHITECTURE "Round 220 additions".
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r220", name: "r220", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

await app(async () => {
  try { await window.__app.vault.create("ed220.md", "alpha bravo charlie\nsecond line\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("ed220.md");
});
await app(() => { const t = window.__app.workspace.getActiveTab(); if (t) window.__app.workspace.setTabMode(t.id, "live"); });
await page.waitForSelector(".cm-content", { timeout: 5000 });
await page.click(".cm-content");
const ready = await page.waitForFunction(() => {
  const ae = window.app.workspace.activeEditor;
  return ae && ae.editor && typeof ae.editor.getDoc === "function";
}, null, { timeout: 5000 }).then(() => true).catch(() => false);
ok("compat activeEditor.editor reachable with R220 getDoc()", ready);

console.log("A. getDoc(): this — returns the editor itself (CM5-legacy alias)");
ok("getDoc() === the editor instance", await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  return e.getDoc() === e;
}));
ok("getDoc().getValue works (it IS the editor)", await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  return e.getDoc().getValue() === e.getValue();
}));

console.log("B. replaceSelection(replacement, origin?) — the new origin arg is accepted (ignored)");
const repl = await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  e.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 }); // select "alpha"
  e.replaceSelection("OMEGA", "my-origin");                // 2-arg call (R220)
  return e.getValue();
});
ok("replaceSelection(text, origin) inserted text (origin ignored, no throw)", repl.startsWith("OMEGA bravo charlie"), JSON.stringify(repl.slice(0, 24)));

console.log("C. setSelections(ranges, main?) — the new main arg is accepted (ignored)");
const selN = await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  e.setSelections([{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 3 } }], 0); // 2-arg call (R220)
  return e.listSelections().length;
});
ok("setSelections(ranges, main) applied a selection (main ignored, no throw)", selN === 1, String(selN));

console.log("D. regression: 1-arg call sites still work (R128 contract intact)");
ok("replaceSelection(text) 1-arg still works", await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  e.setSelection({ line: 1, ch: 0 }, { line: 1, ch: 6 }); // "second"
  e.replaceSelection("DONE");
  return e.getValue().includes("DONE line");
}));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR220: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
