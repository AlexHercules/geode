/**
 * R128 compat Editor 方法补全 E2E — browser mode :1420.
 * Run: node .calibration/r128-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 128 additions" (compat 商业主轴).
 *
 * Obsidian Editor extra methods (all direct CM6 maps): listSelections / setSelections / setLine /
 * transaction / wordAt / scrollIntoView / scrollTo / getScrollInfo / exec / undo / redo / blur.
 * Editor-manipulation plugins use these constantly. Writes dispatch through CM → autosave (the
 * proven-safe path, like the existing replaceRange). Multi-cursor collapses (Geode CM has no
 * allowMultipleSelections — documented deviation, R57), so setSelections is tested single-range.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r128", name: "r128", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

// create + open a note, set live mode, focus the editor so activeEditor resolves
await app(async () => {
  try { await window.__app.vault.create("ed.md", "alpha bravo charlie\nsecond line\nthird line\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("ed.md");
});
await app(() => { const t = window.__app.workspace.getActiveTab(); if (t) window.__app.workspace.setTabMode(t.id, "live"); });
await page.waitForSelector(".cm-content", { timeout: 5000 });
await page.click(".cm-content");
const ready = await page.waitForFunction(() => {
  const ae = window.app.workspace.activeEditor;
  return ae && ae.editor && typeof ae.editor.listSelections === "function";
}, null, { timeout: 5000 }).then(() => true).catch(() => false);
ok("compat activeEditor.editor with the new methods is reachable", ready);

console.log("— listSelections / setSelections (single; multi-cursor collapses, R57) —");
const sel = await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  e.setCursor({ line: 1, ch: 2 });
  const single = e.listSelections();
  e.setSelections([{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 5 } }]);
  return { single, selText: e.getSelection(), after: e.listSelections() };
});
ok("listSelections reflects the caret ([{anchor,head} @ line1 ch2])", eq(sel.single, [{ anchor: { line: 1, ch: 2 }, head: { line: 1, ch: 2 } }]), JSON.stringify(sel.single));
ok("setSelections([0,0→0,5]) selects 'alpha'", sel.selText === "alpha", JSON.stringify(sel.selText));
ok("listSelections after setSelections = the range", eq(sel.after, [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 5 } }]), JSON.stringify(sel.after));

console.log("— setLine / transaction (writes via CM dispatch) —");
const writes = await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  e.setLine(1, "SECOND");
  const line1 = e.getLine(1);
  e.transaction({ changes: [{ from: { line: 2, ch: 0 }, to: { line: 2, ch: 5 }, text: "THIRD" }] });
  return { line1, line2: e.getLine(2), full: e.getValue() };
});
ok("setLine(1, 'SECOND') → getLine(1) === 'SECOND'", writes.line1 === "SECOND", JSON.stringify(writes.line1));
ok("transaction replaces 'third' → 'THIRD line'", writes.line2 === "THIRD line", JSON.stringify(writes.line2));
ok("full doc reflects both edits", writes.full.includes("SECOND") && writes.full.includes("THIRD line"), JSON.stringify(writes.full));

console.log("— wordAt —");
const word = await app(() => window.app.workspace.activeEditor.editor.wordAt({ line: 0, ch: 2 }));
ok("wordAt(line0 ch2) → 'alpha' range {from:0,0 to:0,5}", eq(word, { from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } }), JSON.stringify(word));

console.log("— exec (CM6 command mapping) —");
const exec = await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  e.setCursor({ line: 0, ch: 0 });
  e.exec("goDown");
  const movedLine = e.getCursor().line;
  e.setCursor({ line: 0, ch: 0 });
  e.exec("goEnd");
  const endLine = e.getCursor().line;
  return { movedLine, endLine, lastLine: e.lastLine() };
});
ok("exec('goDown') moves the caret down one line (0 → 1)", exec.movedLine === 1, JSON.stringify(exec.movedLine));
ok("exec('goEnd') moves the caret to the last line", exec.endLine === exec.lastLine, JSON.stringify(exec));

console.log("— undo / redo round-trip —");
const hist = await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  e.setLine(0, "UNDOTEST");
  const a = e.getLine(0);
  e.undo();
  const b = e.getLine(0);
  e.redo();
  const c = e.getLine(0);
  return { a, b, c };
});
ok("undo reverts the edit, redo re-applies it (line0: UNDOTEST → ≠ → UNDOTEST)", hist.a === "UNDOTEST" && hist.b !== "UNDOTEST" && hist.c === "UNDOTEST", JSON.stringify(hist));

console.log("— scroll / blur (no-throw + shape) —");
const misc = await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  const si = e.getScrollInfo();
  let threw = false;
  try { e.scrollIntoView({ from: { line: 2, ch: 0 }, to: { line: 2, ch: 4 } }, true); e.scrollTo(0, 0); e.refresh(); } catch { threw = true; }
  e.blur();
  return { si, threw, hasFocus: e.hasFocus() };
});
ok("getScrollInfo returns {top, left} numbers", typeof misc.si.top === "number" && typeof misc.si.left === "number", JSON.stringify(misc.si));
ok("scrollIntoView / scrollTo / refresh do not throw", misc.threw === false);
ok("blur() drops editor focus", misc.hasFocus === false);

console.log("— transaction(changes + selection): caret maps through the changes, no throw (review MAJOR) —");
const txSel = await app(() => {
  const e = window.app.workspace.activeEditor.editor;
  e.setValue("0123456789\n");
  let threw = false;
  try { e.transaction({ changes: [{ from: { line: 0, ch: 0 }, text: "AAAAA" }], selection: { from: { line: 0, ch: 6 } } }); } catch { threw = true; }
  const cur = e.getCursor();
  // CASE A: a big deletion + an out-of-NEW-range original selection offset must NOT throw (mapped)
  e.setValue("L0\nL1\nL2\n");
  let threwA = false;
  try { e.transaction({ changes: [{ from: { line: 0, ch: 0 }, to: { line: 2, ch: 2 }, text: "x" }], selection: { from: { line: 2, ch: 2 } } }); } catch { threwA = true; }
  return { threw, cur, threwA, valA: e.getValue() };
});
ok("transaction(changes+selection) does not throw", txSel.threw === false, JSON.stringify(txSel));
ok("caret follows its content through the +5 insert (original ch6 → new ch11, on '6')", eq(txSel.cur, { line: 0, ch: 11 }), JSON.stringify(txSel.cur));
ok("a deletion + out-of-new-range original selection does NOT throw (mapped/clamped)", txSel.threwA === false, JSON.stringify(txSel.threwA));
ok("the deletion change still applied (doc starts with 'x')", txSel.valA.startsWith("x"), JSON.stringify(txSel.valA.slice(0, 6)));

console.log("— data-safety: a setLine edit PERSISTS through autosave to the vault (R123 口径) —");
const persisted = await app(async () => {
  const e = window.app.workspace.activeEditor.editor;
  e.setLine(0, "PERSISTED line zero");
  await new Promise((r) => setTimeout(r, 1200)); // autosave debounce + flush
  return await window.__app.vault.read("ed.md");
});
ok("after setLine + autosave, vault.read('ed.md') starts with the new line 0", persisted.startsWith("PERSISTED line zero"), JSON.stringify(persisted.slice(0, 40)));

console.log(`\nR128 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
