/**
 * R52 editing commands (toggle-comment / indent / unindent / insert-blank-line /
 * select-line) E2E — browser vs :1420.
 * Run: node .calibration/r52-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 52 additions".
 *
 *  A. pure transform (window.__geodeEdit): the CM StateCommands on a throwaway state
 *     built with markdown + %% commentTokens.
 *  B. live command: editor:toggle-comment / editor:indent on a real CM view.
 *  C. hotkey routing: Mod+/ keystroke through the Prec.highest interceptor.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r52", name: "r52", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeEdit, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. pure transforms (window.__geodeEdit) ──────────────────────────────────
console.log("A. pure transforms (window.__geodeEdit)");
ok("toggle-comment wraps a selection in %%", (await app(() => window.__geodeEdit.toggleComment("hello", 0, 5).doc)) === "%% hello %%");
ok("toggle-comment unwraps %% (round-trip)", (await app(() => window.__geodeEdit.toggleComment("%% hello %%", 0, 11).doc)) === "hello");
ok("toggle-comment comments the cursor line", (await app(() => window.__geodeEdit.toggleComment("abc\ndef\n", 5, 5).doc)) === "abc\n%% def %%\n");
ok("indent inserts a 2-space indent", (await app(() => window.__geodeEdit.indent("abc", 0).doc)) === "  abc");
ok("unindent removes the indent", (await app(() => window.__geodeEdit.unindent("  abc", 2).doc)) === "abc");
ok("insert-blank-line adds a newline below", (await app(() => window.__geodeEdit.insertBlankLine("abc", 3).doc)) === "abc\n");
ok("select-line selects the whole line + break", (await app(() => { const r = window.__geodeEdit.selectLine("a\nb\nc", 2); return `${r.from},${r.to}`; })) === "2,4");

// ── B. live command on a real CM view ────────────────────────────────────────
console.log("B. live command (editor:toggle-comment / editor:indent)");
const SRC = "EC.md";
await app(async (p) => { try { await window.__app.vault.create(p, "alpha\nbeta\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SRC);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, SRC);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await wait(80);
const liveDoc = () => app(() => window.__app.documents.getActiveView()?.view.state.doc.toString() ?? "");
// cursor on line "alpha" (offset 0)
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(40);
await app(() => window.__app.commands.execute("editor:toggle-comment"));
await wait(120);
const doc1 = await liveDoc();
ok("editor:toggle-comment comments line alpha", doc1.startsWith("%% alpha %%\nbeta"), JSON.stringify(doc1));
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(40);
await app(() => window.__app.commands.execute("editor:toggle-comment"));
await wait(120);
const doc2 = await liveDoc();
ok("editor:toggle-comment uncomments (round-trip)", doc2.startsWith("alpha\nbeta"), JSON.stringify(doc2));
// indent line "beta" (offset 6)
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 6 } }); });
await wait(40);
await app(() => window.__app.commands.execute("editor:indent"));
await wait(120);
const doc3 = await liveDoc();
ok("editor:indent indents line beta", doc3.startsWith("alpha\n  beta"), JSON.stringify(doc3));

// ── C. real keystroke routes Mod+/ through the Prec.highest interceptor ───────
console.log("C. hotkey routing (Mod+/ via interceptor)");
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "one\ntwo\n" }, selection: { anchor: 0 } }); });
await wait(40);
await page.click(".cm-content");
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(20);
await page.keyboard.press("Meta+/"); // Mod = Cmd on the macOS dev host
await wait(120);
const doc4 = await liveDoc();
ok("Meta+/ keystroke comments line one", doc4.startsWith("%% one %%\ntwo"), JSON.stringify(doc4));

console.log(`\nR52 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
