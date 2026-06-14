/**
 * R51 line-motion commands (move/copy line) E2E — browser vs :1420.
 * Run: node .calibration/r51-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 51 additions".
 *
 *  A. pure transform (window.__geodeMotion): move/copy line up/down on a throwaway state.
 *  B. live command: editor:move-line-* on a real CM view.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r51", name: "r51", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeMotion, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. pure transforms (window.__geodeMotion) ────────────────────────────────
console.log("A. pure transforms (window.__geodeMotion)");
// doc "a\nb\nc", cursor on line "b" (anchor 2)
ok("moveUp: line b above a → 'b\\na\\nc'", (await app(() => window.__geodeMotion.moveUp("a\nb\nc", 2))) === "b\na\nc");
ok("moveDown: line b below c → 'a\\nc\\nb'", (await app(() => window.__geodeMotion.moveDown("a\nb\nc", 2))) === "a\nc\nb");
ok("copyUp: duplicates line b → 'a\\nb\\nb\\nc'", (await app(() => window.__geodeMotion.copyUp("a\nb\nc", 2))) === "a\nb\nb\nc");
ok("copyDown: duplicates line b → 'a\\nb\\nb\\nc'", (await app(() => window.__geodeMotion.copyDown("a\nb\nc", 2))) === "a\nb\nb\nc");
ok("moveUp on the first line is a no-op", (await app(() => window.__geodeMotion.moveUp("a\nb\nc", 0))) === "a\nb\nc");
ok("moveDown on the last line is a no-op", (await app(() => window.__geodeMotion.moveDown("a\nb\nc", 4))) === "a\nb\nc");

// ── B. live command on a real CM view ────────────────────────────────────────
console.log("B. live command (editor:move-line-up)");
const SRC = "ML.md";
await app(async (p) => { try { await window.__app.vault.create(p, "line1\nline2\nline3\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SRC);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, SRC);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content"); // focus → registers the active editor view (r40 precedent)
await wait(80);
// cursor on line2 (offset 6 = just after "line1\n")
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 6 } }); });
await wait(40);
await app(() => window.__app.commands.execute("editor:move-line-up"));
await wait(120);
const liveDoc = () => app(() => window.__app.documents.getActiveView()?.view.state.doc.toString() ?? "");
const doc1 = await liveDoc();
ok("editor:move-line-up moves line2 above line1", doc1.startsWith("line2\nline1\nline3"), JSON.stringify(doc1));
// now line2 is on the top; move-line-down sends it back
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(40);
await app(() => window.__app.commands.execute("editor:move-line-down"));
await wait(120);
const doc2 = await liveDoc();
ok("editor:move-line-down restores the order", doc2.startsWith("line1\nline2\nline3"), JSON.stringify(doc2));
// copy-line-down duplicates
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(40);
await app(() => window.__app.commands.execute("editor:copy-line-down"));
await wait(120);
const doc3 = await liveDoc();
ok("editor:copy-line-down duplicates line1", doc3.startsWith("line1\nline1\n"), JSON.stringify(doc3));

// ── C. real keystroke routes through the Prec.highest interceptor ─────────────
// Proves Alt+ArrowUp (the bound hotkey) is intercepted before CM defaultKeymap +
// the contentEditable default — not just that commands.execute() works.
console.log("C. hotkey routing (Alt+ArrowUp via interceptor)");
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "alpha\nbeta\ngamma\n" }, selection: { anchor: 6 } }); });
await wait(40);
await page.click(".cm-content"); // ensure the CM contentDOM owns focus
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 6 } }); }); // cursor on "beta"
await wait(20);
await page.keyboard.press("Alt+ArrowUp");
await wait(120);
const doc4 = await liveDoc();
ok("Alt+ArrowUp keystroke moves 'beta' above 'alpha'", doc4.startsWith("beta\nalpha\ngamma"), JSON.stringify(doc4));

console.log(`\nR51 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
