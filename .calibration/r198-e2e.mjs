/**
 * R198 — G3 missing→done: editor:insert-math (行内数学 `$…$`) /
 * editor:insert-math-block (插入数学块 `$$…$$`) / editor:insert-horizontal-rule
 * (插入分隔线 `***`). Extends the R33 pure format engine (core/format.ts) with 3
 * INSERT-only ops. Browser :1420.   Run: node .calibration/r198-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 198 additions".
 *
 * A  = byte-level __geodeFormat.apply probe (exact FormatEdit) for each op.
 * D  = setext-safety render PROOF via __geodeRenderMarkdown: `***` after text →
 *      <hr> + paragraph kept, whereas `---` would become a setext <h2> (the trap
 *      the contract avoids). B = command registration + no default hotkey.
 * C  = live CM view: real command edits the doc, rest unchanged.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r198", name: "r198", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFormat && !!window.__app && !!window.__geodeRenderMarkdown, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const apply = (op, text, from, to) =>
  app(([o, t, f, u]) => window.__geodeFormat.apply(o, t, f, u), [op, text, from, to]);
const render = (src) => app((s) => window.__geodeRenderMarkdown(s), src);

console.log("A. inline-math byte-level ($…$, single $, pure insert)");
let e = await apply("inline-math", "", 0, 0);
ok("empty sel → '$$' cursor between", e?.insert === "$$" && e.selFrom === 1 && e.selTo === 1, JSON.stringify(e));
e = await apply("inline-math", "ab", 1, 1);
ok("mid-text empty sel → '$$' at cursor, span [1,1]", e?.insert === "$$" && e.from === 1 && e.to === 1 && e.selFrom === 2, JSON.stringify(e));
e = await apply("inline-math", "x", 0, 1);
ok("sel 'x' → '$x$' cursor after close (selFrom=3)", e?.insert === "$x$" && e.selFrom === 3 && e.selTo === 3, JSON.stringify(e));
e = await apply("inline-math", "a b c", 2, 3);
ok("middle sel 'b' → '$b$', span = [2,3] only", e?.insert === "$b$" && e.from === 2 && e.to === 3 && e.selFrom === 5, JSON.stringify(e));
e = await apply("inline-math", "a^2+b^2", 0, 7);
ok("content preserved verbatim: '$a^2+b^2$'", e?.insert === "$a^2+b^2$", JSON.stringify(e));
e = await apply("inline-math", "$x$", 0, 3);
ok("not a toggle: '$x$' → '$$x$$' (wraps, never unwraps)", e?.insert === "$$x$$", JSON.stringify(e));

console.log("A2. math-block byte-level ($$…$$ block, line-level, pure insert)");
e = await apply("math-block", "", 0, 0);
ok("empty line → '$$\\n\\n$$' cursor on middle line (selFrom=3)", e?.insert === "$$\n\n$$" && e.from === 0 && e.to === 0 && e.selFrom === 3 && e.selTo === 3, JSON.stringify(e));
e = await apply("math-block", "x=1", 0, 3);
ok("sel 'x=1' → '$$\\nx=1\\n$$', inner selected [3,6]", e?.insert === "$$\nx=1\n$$" && e.selFrom === 3 && e.selTo === 6, JSON.stringify(e));
e = await apply("math-block", "x=1", 1, 1);
ok("cursor mid-line wraps WHOLE line (lineBounds), span [0,3]", e?.insert === "$$\nx=1\n$$" && e.from === 0 && e.to === 3, JSON.stringify(e));
e = await apply("math-block", "a\nb", 0, 3);
ok("multi-line sel → '$$\\na\\nb\\n$$'", e?.insert === "$$\na\nb\n$$" && e.selFrom === 3 && e.selTo === 6, JSON.stringify(e));
e = await apply("math-block", "pre\nx\npost", 4, 5);
ok("surrounding lines untouched: span = the 'x' line [4,5] only", e?.insert === "$$\nx\n$$" && e.from === 4 && e.to === 5, JSON.stringify(e));

console.log("A3. horizontal-rule byte-level (*** , setext-proof, does NOT consume selection)");
e = await apply("horizontal-rule", "", 0, 0);
ok("empty doc → '***\\n' (no lead, at start)", e?.insert === "***\n" && e.from === 0 && e.to === 0 && e.selFrom === 4, JSON.stringify(e));
e = await apply("horizontal-rule", "Hello", 5, 5);
ok("end of text line → '\\n***\\n' (lead added)", e?.insert === "\n***\n" && e.from === 5 && e.to === 5, JSON.stringify(e));
e = await apply("horizontal-rule", "a\n", 2, 2);
ok("on empty line (after \\n) → '***\\n' (no lead)", e?.insert === "***\n" && e.from === 2 && e.to === 2, JSON.stringify(e));
e = await apply("horizontal-rule", "ab", 1, 1);
ok("mid-line → '\\n***\\n' splits the line", e?.insert === "\n***\n" && e.from === 1 && e.to === 1, JSON.stringify(e));
e = await apply("horizontal-rule", "keep this", 0, 9);
ok("底线①: selection NOT consumed (span collapses to end [9,9], text kept)", e?.from === 9 && e.to === 9, JSON.stringify(e));
ok("marker is '***' never '---' (setext-proof)", e && e.insert.includes("***") && !e.insert.includes("---"), JSON.stringify(e));

console.log("D. setext-safety render PROOF (__geodeRenderMarkdown)");
const hrHtml = await render("Hello\n***\n");
ok("'Hello\\n***\\n' → renders an <hr>", /<hr\b/.test(hrHtml), hrHtml);
ok("'Hello\\n***\\n' → 'Hello' stays a paragraph, NOT a heading", /<p>Hello<\/p>/.test(hrHtml) && !/<h2/.test(hrHtml), hrHtml);
const setextHtml = await render("Hello\n---\n");
ok("CONTRAST: 'Hello\\n---\\n' WOULD be a setext <h2> (the trap '***' avoids)", /<h[12]/.test(setextHtml), setextHtml);
const inlineHtml = await render("see $a^2$ here");
ok("inline '$a^2$' renders as a geode-math-inline span (real math markup, not raw $)", /class="[^"]*geode-math-inline/.test(inlineHtml), inlineHtml);
const blockHtml = await render("$$\nx=1\n$$\n");
ok("block '$$…$$' renders as geode-math-block (display math)", /class="[^"]*geode-math-block/.test(blockHtml), blockHtml);

console.log("B. command registration + no default hotkey (Obsidian '未设置')");
const reg = await app(() => {
  const ids = ["editor:insert-math", "editor:insert-math-block", "editor:insert-horizontal-rule"];
  return ids.map((id) => {
    const c = window.__app.commands.list().find((x) => x.id === id);
    return { id, present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey(id) || null };
  });
});
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("cmd."), String(r.name));
  ok(`${r.id} has NO default hotkey`, r.hotkey === null, String(r.hotkey));
}

console.log("C. live CM view: real command edits doc, rest unchanged");
await app(async () => { try { await window.__app.vault.create("r198.md", "alpha beta gamma\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r198.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);
// inline-math: select "beta" (6..10)
await app(() => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: 6, head: 10 } }));
await wait(60);
await app(() => window.__app.commands.execute("editor:insert-math"));
await wait(100);
let after = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live inline-math: 'beta' → '$beta$'", after === "alpha $beta$ gamma\n", JSON.stringify(after));

// horizontal-rule: collapse cursor to end of "gamma" (before final \n at idx 18 in new doc), run command
await app(() => {
  const v = window.__app.documents.getActiveView().view;
  v.dispatch({ selection: { anchor: v.state.doc.length - 1, head: v.state.doc.length - 1 } });
});
await wait(60);
await app(() => window.__app.commands.execute("editor:insert-horizontal-rule"));
await wait(100);
after = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live horizontal-rule: inserts '***' on its own line, prior text intact", after.includes("$beta$") && /\n\*\*\*\n/.test(after) && !after.includes("---"), JSON.stringify(after));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR198: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
