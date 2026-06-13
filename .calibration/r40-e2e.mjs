/**
 * R40 toggle checkbox status (Cmd/Ctrl-L) E2E — browser mode (Memory vault) vs dev :1420.
 * Run: node .calibration/r40-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 40 additions".
 *
 * Reuses the R33 format infrastructure: a new pure op `toggle-task` in
 * core/format.ts, exposed through the existing window.__geodeFormat.apply probe,
 * registered as editor:toggle-checkbox (Mod+L). Covers:
 *  A. pure transform via __geodeFormat.apply("toggle-task", text, from, to).
 *  B. live CM editor + REAL Mod+L keystroke (R33 Prec.highest interceptor) + autosave.
 *  C. command layer (editor:toggle-checkbox) converts a non-task line to a task.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r40", name: "r40", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFormat, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const apply = (text, from, to) => app(([t, f, e]) => window.__geodeFormat.apply("toggle-task", t, f, e), [text, from, to]);
const insertOf = async (text, from, to) => (await apply(text, from ?? 0, to ?? text.length))?.insert ?? null;

// ── A. pure transform ────────────────────────────────────────────────────────
console.log("A. pure transform (__geodeFormat.apply 'toggle-task')");
ok("'- [ ] task' → '- [x] task'", (await insertOf("- [ ] task")) === "- [x] task");
ok("'- [x] task' → '- [ ] task'", (await insertOf("- [x] task")) === "- [ ] task");
ok("'- [X] task' (uppercase checked) → '- [ ] task'", (await insertOf("- [X] task")) === "- [ ] task");
ok("'- bullet' (no box) → '- [ ] bullet'", (await insertOf("- bullet")) === "- [ ] bullet");
ok("'plain' → '- [ ] plain'", (await insertOf("plain")) === "- [ ] plain");
ok("'* foo' → '- [ ] foo' (marker normalized)", (await insertOf("* foo")) === "- [ ] foo");
ok("'1. foo' → '- [ ] foo'", (await insertOf("1. foo")) === "- [ ] foo");
ok("'' (empty line) → '- [ ] '", (await insertOf("")) === "- [ ] ");
ok("indent preserved '  - [ ] x' → '  - [x] x'", (await insertOf("  - [ ] x")) === "  - [x] x");
ok("multi-line mixed toggles per line",
  (await insertOf("- [ ] a\nplain\n- [x] b")) === "- [x] a\n- [ ] plain\n- [ ] b");
ok("multi-line keeps blank separator", (await insertOf("- [ ] a\n\n- [ ] b")) === "- [x] a\n\n- [x] b");
// custom checkbox states flip in place (R40 review fix — never malformed/double-box)
ok("custom '- [/] doing' → '- [x] doing' (flip, not prepend)", (await insertOf("- [/] doing")) === "- [x] doing");
ok("custom '- [-] x' → '- [x] x'", (await insertOf("- [-] x")) === "- [x] x");
ok("custom flip is idempotent-valid ('- [x] x' → '- [ ] x')", (await insertOf("- [x] x")) === "- [ ] x");
ok("multi-char '[text]' is NOT a checkbox (converted, single-char boundary)", (await insertOf("- [text] foo")) === "- [ ] [text] foo");

// ── B. live CM editor + real Mod+L + autosave ────────────────────────────────
console.log("B. live editor (real Mod+L via R33 interceptor) + autosave");
const SCRATCH = "r40/scratch.md";
await app(async (p) => { try { await window.__app.vault.create(p, "- [ ] buy milk\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SCRATCH);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, SCRATCH);
await page.waitForSelector(".cm-content", { timeout: 4000 });
const getDoc = () => app((p) => window.__app.documents.get(p)?.getText() ?? "", SCRATCH);
await page.click(".cm-content");
await wait(40);
// place the cursor ON the task line (line 1); a click lands at the doc end (the
// empty line after the trailing newline), where Cmd+L would make a new checkbox.
const cursorToStart = () => app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await cursorToStart();
await wait(20);
const mod = process.platform === "darwin" ? "Meta" : "Control";
await page.keyboard.press(`${mod}+l`);
await wait(80);
ok("real Mod+L checks the task ([ ] → [x])", (await getDoc()).trim() === "- [x] buy milk", JSON.stringify(await getDoc()));
await page.keyboard.press(`${mod}+l`);
await wait(80);
ok("real Mod+L again unchecks ([x] → [ ])", (await getDoc()).trim() === "- [ ] buy milk", JSON.stringify(await getDoc()));
// autosave: the toggle persists to the vault past the debounce
await page.keyboard.press(`${mod}+l`); // → [x]
await wait(700);
const onDisk = await app((p) => window.__app.vault.read(p), SCRATCH);
ok("toggle autosaves to vault ([x] on disk)", onDisk.includes("- [x] buy milk"), JSON.stringify(onDisk));

// ── C. command layer converts a non-task line ────────────────────────────────
console.log("C. command layer (editor:toggle-checkbox) on a non-task line");
const SCRATCH2 = "r40/scratch2.md";
await app(async (p) => { try { await window.__app.vault.create(p, "hello world\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SCRATCH2);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "live");
  await new Promise((r) => setTimeout(r, 200));
}, SCRATCH2);
await page.click(".cm-content");
await wait(40);
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(20);
await app(() => window.__app.commands.execute("editor:toggle-checkbox"));
await wait(80);
const doc2 = await app((p) => window.__app.documents.get(p)?.getText() ?? "", SCRATCH2);
ok("command converts 'hello world' → '- [ ] hello world'", doc2.trim() === "- [ ] hello world", JSON.stringify(doc2));

console.log(`\nR40 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
