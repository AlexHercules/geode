/**
 * R63 multiple cursors / selections E2E — browser mode against dev :1420.
 * Run: node .calibration/r63-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 63 additions".
 *
 * Covers ㉕ multi-cursor. The 2-line foundation (EditorState.allowMultipleSelections
 * + drawSelection) is the real gap — without it Geode could not render >1 cursor at
 * all. It unlocks CM's already-present keymaps: Mod-Alt-↓/↑ addCursorBelow/Above,
 * Escape simplifySelection (keyboard-first, aligned with Geode's stated principle;
 * Obsidian core multi-cursor is mouse-based). Drives the REAL CM editor by keyboard,
 * reads the doc buffer (edits land at every cursor) AND counts .cm-cursor
 * (drawSelection actually renders the secondary cursors).
 *
 * NOTE: Mod-d is intentionally NOT tested as select-next-occurrence — it is bound to
 * Geode's daily-note command (and select-next is an Obsidian *community* plugin, not
 * core), so the interceptor owns Mod-d. See ARCHITECTURE "Round 63 additions".
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r63", name: "r63", onload(app) { window.__app = app; } }));

const create = (p, c) => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 60));
}, [p, c]);
const openLive = (p) => page.evaluate(async (path) => {
  window.__app.workspace.openFile(path);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 220));
}, p);
const activeFile = () => page.evaluate(() => window.__app.workspace.getActiveFile());
const docText = () => page.evaluate(() => {
  const p = window.__app.workspace.getActiveFile();
  return window.__app.documents.get(p)?.getText() ?? null;
});
const cursors = () => page.$$eval(".cm-cursorLayer .cm-cursor", (els) => els.length).catch(() => -1);
const focusStart = async () => {
  await page.click(".cm-content");
  await page.keyboard.press("Escape"); // clear any pending completion state
  await page.keyboard.press(`${MOD}+Home`); // cursorDocStart
  await page.waitForTimeout(60);
};

console.log("— addCursorBelow: drawSelection renders N cursors, edit lands at each —");
await create("MC.md", "a\nb\nc\n");
await openLive("MC.md");
ok("MC.md is the active file", (await activeFile()) === "MC.md", await activeFile());
await focusStart();
await page.keyboard.press(`${MOD}+Alt+ArrowDown`);
await page.keyboard.press(`${MOD}+Alt+ArrowDown`);
await page.waitForTimeout(60);
ok("drawSelection renders 3 cursors", (await cursors()) === 3, String(await cursors()));
await page.keyboard.type("X");
await page.waitForTimeout(80);
ok("typing X inserts at all 3 line starts → Xa/Xb/Xc", (await docText()) === "Xa\nXb\nXc\n", JSON.stringify(await docText()));

console.log("— Escape (simplifySelection) collapses to one cursor (clean path) —");
await create("MC2.md", "p\nq\nr\n");
await openLive("MC2.md");
await focusStart();
await page.keyboard.press(`${MOD}+Alt+ArrowDown`);
await page.keyboard.press(`${MOD}+Alt+ArrowDown`);
await page.waitForTimeout(60);
ok("3 cursors before Escape", (await cursors()) === 3, String(await cursors()));
await page.keyboard.press("Escape");
await page.waitForTimeout(80);
ok("after Escape only 1 cursor remains", (await cursors()) === 1, String(await cursors()));
await page.keyboard.type("Y");
await page.waitForTimeout(80);
const yDoc = await docText();
ok("typing Y after Escape inserts exactly once (single cursor)", (yDoc.match(/Y/g) || []).length === 1, JSON.stringify(yDoc));

console.log("— addCursorAbove: cursor on the line above —");
await create("MC3.md", "m\nn\no\n");
await openLive("MC3.md");
await page.click(".cm-content");
await page.keyboard.press("Escape");
await page.keyboard.press(`${MOD}+End`); // cursorDocEnd (last line)
await page.waitForTimeout(60);
await page.keyboard.press(`${MOD}+Alt+ArrowUp`);
await page.keyboard.press(`${MOD}+Alt+ArrowUp`);
await page.waitForTimeout(60);
ok("addCursorAbove renders 3 cursors", (await cursors()) === 3, String(await cursors()));
await page.keyboard.type("Z");
await page.waitForTimeout(80);
const zDoc = await docText();
ok("typing Z inserts at all 3 cursors (3 × Z)", (zDoc.match(/Z/g) || []).length === 3, JSON.stringify(zDoc));

console.log("— data safety (review fix): a secondary cursor cannot delete the frontmatter closing-fence newline —");
await create("FM.md", "---\ntitle: T\n---\nalpha\nbeta\n");
await openLive("FM.md");
const fmBefore = await docText();
// put a cursor at the first body line ("alpha") start, add one below (main moves to
// "beta"), then Backspace. The first-body-line cursor is now a SECONDARY range parked
// at the protected position — the R63 guard must swallow the whole keystroke so the
// closing-fence \n is not deleted (pre-fix, the main-only guard let it through).
await page.click("text=alpha");
await page.keyboard.press("Home");
await page.waitForTimeout(40);
await page.keyboard.press(`${MOD}+Alt+ArrowDown`);
await page.keyboard.press("Backspace");
await page.waitForTimeout(80);
ok("frontmatter intact — multi-cursor Backspace at first-body-line start is swallowed", (await docText()) === fmBefore, JSON.stringify(await docText()));

console.log(`\nR63 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
