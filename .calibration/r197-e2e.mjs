/**
 * R197 — G3 missing→done: editor:delete-paragraph (Obsidian "Delete paragraph") —
 * browser :1420. Run: node .calibration/r197-e2e.mjs   (dev server up)
 * Contract: docs/ARCHITECTURE.md "Round 197 additions".
 *
 * Deletes the top-level block at the cursor via the syntax tree (a whole block, never a
 * line-based slice). Byte-critical cases: a fenced code block with a blank line is removed
 * whole (not split), and the frontmatter (incl. multi-line values) is a safe no-op.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r197", name: "r197", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("— command registered + name resolves + no default hotkey —");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:delete-paragraph");
  return { present: !!c, name: c ? c.name() : null, hk: window.__app.commands.getEffectiveHotkey("editor:delete-paragraph") || null };
});
ok("editor:delete-paragraph registered", reg.present);
ok("name resolves (not raw key)", !!reg.name && !reg.name.startsWith("cmd."), reg.name);
ok("has no default hotkey (Obsidian parity)", reg.hk === null, reg.hk);

await app(async () => { try { await window.__app.vault.create("r197dp.md", "x\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r197dp.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);

// set whole-doc content, put the cursor at `cursor` (a substring → its index), run, return doc
async function delParaAt(content, at) {
  await app(([c, p]) => {
    const v = window.__app.documents.getActiveView().view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c }, selection: { anchor: p } });
  }, [content, at]);
  await wait(150); // let the markdown parse settle so syntaxTree is complete
  await app(() => window.__app.commands.execute("editor:delete-paragraph"));
  await wait(90);
  return app(() => window.__app.documents.getActiveView().view.state.doc.toString());
}
// cursor at the START of `cursorSubstr` (resolveInner side=1 enters the block there)
const delPara = (content, cursorSubstr) => delParaAt(content, content.indexOf(cursorSubstr));

console.log("— deletes the whole block at the cursor (paragraph / heading / list) —");
ok("first paragraph → next moves up", (await delPara("p1\n\np2\n", "p1")) === "p2\n", await delPara("p1\n\np2\n", "p1"));
ok("middle paragraph removed", (await delPara("a\n\nb\n\nc\n", "b")) === "a\n\nc\n", await delPara("a\n\nb\n\nc\n", "b"));
ok("heading block removed", (await delPara("# H\n\ntext\n", "# H")) === "text\n", await delPara("# H\n\ntext\n", "# H"));
ok("list = whole list removed (top-level block; documented deviation)", (await delPara("- a\n- b\n- c\n", "- b")) === "", await delPara("- a\n- b\n- c\n", "- b"));

console.log("— BYTE SAFETY: a fenced code block with a blank line is removed WHOLE (not split) —");
ok("fenced code w/ blank → whole fence gone, no orphan ```", (await delPara("```\nl1\n\nl2\n```\n", "l1")) === "", await delPara("```\nl1\n\nl2\n```\n", "l1"));
ok("paragraph after a fence is independent", (await delPara("```\nc\n```\n\npara\n", "para")) === "```\nc\n```\n\n", await delPara("```\nc\n```\n\npara\n", "para"));

console.log("— BYTE SAFETY: frontmatter is a safe no-op (incl. multi-line values) —");
ok("cursor in frontmatter → unchanged", (await delPara("---\nk: v\n---\nbody\n", "k: v")) === "---\nk: v\n---\nbody\n", await delPara("---\nk: v\n---\nbody\n", "k: v"));
ok("cursor in a multi-line frontmatter value → unchanged (no split)", (await delPara("---\ndesc: |\n  l1\n\n  l2\n---\nbody\n", "l1")) === "---\ndesc: |\n  l1\n\n  l2\n---\nbody\n", await delPara("---\ndesc: |\n  l1\n\n  l2\n---\nbody\n", "l1"));
ok("body after frontmatter deletes, frontmatter preserved", (await delPara("---\nk: v\n---\nbody\n", "body")) === "---\nk: v\n---\n", await delPara("---\nk: v\n---\nbody\n", "body"));

console.log("— BYTE SAFETY: a multi-line overlay Lezer would split (block math / %%comment%%) is removed WHOLE —");
ok("block math w/ blank line → whole math gone (not split)", (await delPara("$$\na\n\nb\n$$\n\npara\n", "a")) === "para\n", await delPara("$$\na\n\nb\n$$\n\npara\n", "a"));
ok("block comment w/ blank line → whole comment gone (not split)", (await delPara("%%\nc1\n\nc2\n%%\n\npara\n", "c1")) === "para\n", await delPara("%%\nc1\n\nc2\n%%\n\npara\n", "c1"));
ok("inline %%comment%% in a paragraph → whole paragraph deleted (overlay contained, not overridden)", (await delPara("text %%c%% more\n\nnext\n", "text")) === "next\n", await delPara("text %%c%% more\n\nnext\n", "text"));

console.log("— BYTE SAFETY (review-found): indented code keeps its indent; indent≤3 math + straddling comment —");
// A: indented code block — leading indentation must not be stranded
ok("indented code block deleted whole (no stranded leading indent)", (await delPara("    code a\n\n    code b\nafter\n", "code a")) === "after\n", await delPara("    code a\n\n    code b\nafter\n", "code a"));
ok("solo indented code block deleted whole", (await delPara("    solo code\nafter\n", "solo")) === "after\n", await delPara("    solo code\nafter\n", "solo"));
// B: indent-1..3 block math (reading-view authority; findMathBlockRanges misses it)
ok("indent-3 block math w/ blank → whole math gone (not bisected)", (await delPara("   $$\n   a\n\n   b\n   $$\n\nkeep\n", "   a")) === "keep\n", await delPara("   $$\n   a\n\n   b\n   $$\n\nkeep\n", "   a"));
// C: comment straddling visible text (cursor OUTSIDE the span) → intersection, no orphan %%
ok("cursor in lead text before a blank-spanning %%comment → no orphaned %%", !(await delPara("text %%comment\n\nmore comment%% after\n", "text")).includes("%%"), await delPara("text %%comment\n\nmore comment%% after\n", "text"));
ok("cursor in trail text after a blank-spanning %%comment closer → no orphaned %%", !(await delPara("text %%comment\n\nmore comment%% trail\n", "trail")).includes("%%"), await delPara("text %%comment\n\nmore comment%% trail\n", "trail"));
// an UNPAIRED %% (half-written comment) must NOT drag the deletion to EOF — only the cursor block goes
ok("unpaired %% opener: cursor in opener block → only that block deleted (not to EOF)", (await delPara("intro %%open\n\nkeep this\n\ncursor here\n", "intro")) === "keep this\n\ncursor here\n", await delPara("intro %%open\n\nkeep this\n\ncursor here\n", "intro"));
ok("unpaired %% earlier in doc: cursor in a LATER block → only that block deleted (content above survives)", (await delPara("%%TODO\n\nkeep this\n\ncursor here\n", "cursor here")) === "%%TODO\n\nkeep this\n\n", await delPara("%%TODO\n\nkeep this\n\ncursor here\n", "cursor here"));

console.log("— caret at the end of a block's last line still deletes (F2 fix) —");
ok("end-of-doc caret (no trailing newline) deletes the paragraph", (await delParaAt("hello world", 11)) === "", await delParaAt("hello world", 11));
ok("end-of-line caret deletes that paragraph, next survives", (await delParaAt("aaa\n\nbbb", 3)) === "bbb", await delParaAt("aaa\n\nbbb", 3));

console.log("— undoable (normal CM transaction) —");
await app(() => {
  const v = window.__app.documents.getActiveView().view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "keep\n\ngone\n" }, selection: { anchor: 6 } });
});
await wait(600); // > CM's 500ms coalesce window → setup is its own undo group
await app(() => window.__app.documents.getActiveView().view.dom.focus());
await app(() => window.__app.commands.execute("editor:delete-paragraph"));
await wait(100);
ok("paragraph deleted before undo", !(await app(() => window.__app.documents.getActiveView().view.state.doc.toString())).includes("gone"));
await page.keyboard.press("Meta+z");
await wait(150);
ok("undo restores the deleted paragraph", (await app(() => window.__app.documents.getActiveView().view.state.doc.toString())).includes("gone"), await app(() => window.__app.documents.getActiveView().view.state.doc.toString()));

console.log("— no active editor view: safe no-op —");
await app(() => window.__app.workspace.openGraph());
await wait(150);
await app(() => window.__app.commands.execute("editor:delete-paragraph"));
await wait(80);
ok("delete-paragraph on graph tab does not throw", true);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR197: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
