/**
 * R33 markdown formatting commands + shortcuts E2E — browser mode against dev :1420.
 * Run: node .calibration/r33-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 33 additions".
 *
 * Covers:
 *  A. pure-function probe (__geodeFormat.apply(op, text, from, to)) — deep-equals
 *     the returned FormatEdit {from,to,insert,selFrom,selTo} for every behavior:
 *     - WRAP (bold/italic/strike/highlight/inline-code) via toggleWrap:
 *         wrap selection, empty-selection wrap, unwrap markers-inside-selection,
 *         unwrap markers-outside-selection, the emphasis-char guard (italic on
 *         "**Hello**" must WRAP not strip; bold on "*Hi*" must WRAP), inline-code
 *         unwrap.
 *     - LINK (insertLink): empty / non-URL / URL selections.
 *     - HEADING cycle none→H1…→H6→none.
 *     - BLOCKQUOTE toggle (single + multi-line).
 *     - LISTS: bullet / numbered (two-line) / checklist (+ bullet→checklist swap).
 *     - CODE-BLOCK fence wrap + unwrap.
 *     - CALLOUT wrap + unwrap.
 *  B. live integration in a REAL CM editor: Meta+B wraps the selection and round-
 *     trips back; Meta+I wraps; Meta+K builds a link; commands are registered &
 *     available only while an editable editor is active.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r33", name: "r33", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFormat, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// pure-function probe: apply(op, text, from, to) → FormatEdit | null.
// Deep-equal via JSON.stringify (FormatEdit is a flat object of numbers+string).
const apply = (op, text, from, to) =>
  app(([o, t, f, u]) => window.__geodeFormat.apply(o, t, f, u), [op, text, from, to]);
const eq = (name, actual, expected) =>
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);

// ── A. pure-function probe ───────────────────────────────────────────────────
console.log("A. pure-function probe (__geodeFormat.apply)");

// WRAP — bold
eq("bold wrap selection 'Hello' [0,5]",
  await apply("bold", "Hello", 0, 5),
  { from: 0, to: 5, insert: "**Hello**", selFrom: 2, selTo: 7 });
eq("bold empty-selection wrap → '****' cursor between",
  await apply("bold", "", 0, 0),
  { from: 0, to: 0, insert: "****", selFrom: 2, selTo: 2 });
eq("bold unwrap markers-inside-selection '**Hello**' [0,9]",
  await apply("bold", "**Hello**", 0, 9),
  { from: 0, to: 9, insert: "Hello", selFrom: 0, selTo: 5 });
eq("bold unwrap markers-outside-selection '**Hello**' [2,7]",
  await apply("bold", "**Hello**", 2, 7),
  { from: 0, to: 9, insert: "Hello", selFrom: 0, selTo: 5 });

// WRAP — emphasis-char guard (CRITICAL)
{
  const italic = await apply("italic", "**Hello**", 0, 9);
  ok("italic on '**Hello**' WRAPS not strips (insert ends up '***Hello***')",
    italic && italic.insert === "***Hello***" &&
    italic.insert.startsWith("*") && italic.insert.endsWith("*"),
    JSON.stringify(italic));
  const boldWrap = await apply("bold", "*Hi*", 0, 4);
  ok("bold on '*Hi*' WRAPS to '**' + '*Hi*' + '**' (no false inner-unwrap)",
    boldWrap && boldWrap.insert === "***Hi***" &&
    boldWrap.insert.startsWith("**") && boldWrap.insert.endsWith("**"),
    JSON.stringify(boldWrap));
}

// WRAP — inline-code unwrap
eq("inline-code unwrap '`x`' [0,3] → 'x'",
  await apply("inline-code", "`x`", 0, 3),
  { from: 0, to: 3, insert: "x", selFrom: 0, selTo: 1 });

// LINK
eq("link empty selection → '[]()' cursor in []",
  await apply("link", "", 0, 0),
  { from: 0, to: 0, insert: "[]()", selFrom: 1, selTo: 1 });
eq("link non-URL 'label' [0,5] → '[label]()' cursor in parens",
  await apply("link", "label", 0, 5),
  { from: 0, to: 5, insert: "[label]()", selFrom: 8, selTo: 8 });
eq("link URL 'https://x.com' → '[](https://x.com)' cursor in []",
  await apply("link", "https://x.com", 0, 13),
  { from: 0, to: 13, insert: "[](https://x.com)", selFrom: 1, selTo: 1 });

// HEADING cycle
{
  const h1 = await apply("heading", "foo", 0, 3);
  ok("heading 'foo' → '# foo'", h1 && h1.insert === "# foo", JSON.stringify(h1));
  const h2 = await apply("heading", "# foo", 0, 5);
  ok("heading '# foo' → '## foo'", h2 && h2.insert === "## foo", JSON.stringify(h2));
  const h0 = await apply("heading", "###### foo", 0, 10);
  ok("heading '###### foo' wraps to none → 'foo'", h0 && h0.insert === "foo", JSON.stringify(h0));
  // R33 review fix: a no-space '#Heading' cycles to clean '# Heading' (not '# #Heading')
  const hns = await apply("heading", "#Heading", 0, 8);
  ok("heading '#Heading' (no space) → '# Heading' (not '# #Heading')", hns && hns.insert === "# Heading", JSON.stringify(hns));
}

// R33 review fix: lineBounds invariant — single-newline doc + select-all must not
// produce a from>to change (code-block path); just assert it does not throw / null-safe.
{
  const cb = await apply("code-block", "\n", 0, 1);
  ok("code-block on doc '\\n' [0,1] is from<=to (no RangeError)", cb && cb.from <= cb.to, JSON.stringify(cb));
}

// BLOCKQUOTE
{
  const q = await apply("blockquote", "foo", 0, 3);
  ok("blockquote 'foo' → '> foo'", q && q.insert === "> foo", JSON.stringify(q));
  const uq = await apply("blockquote", "> foo", 0, 5);
  ok("blockquote '> foo' → 'foo'", uq && uq.insert === "foo", JSON.stringify(uq));
  const multi = await apply("blockquote", "> a\n> b", 0, 7);
  ok("blockquote all-quoted multi-line → unquote", multi && multi.insert === "a\nb", JSON.stringify(multi));
}

// LISTS — bullet
{
  const b = await apply("bullet-list", "foo", 0, 3);
  ok("bullet 'foo' → '- foo'", b && b.insert === "- foo", JSON.stringify(b));
  const ub = await apply("bullet-list", "- foo", 0, 5);
  ok("bullet '- foo' → 'foo'", ub && ub.insert === "foo", JSON.stringify(ub));
}
// LISTS — numbered (two lines)
{
  const n = await apply("numbered-list", "a\nb", 0, 3);
  ok("numbered two-line 'a\\nb' → '1. a\\n2. b'", n && n.insert === "1. a\n2. b", JSON.stringify(n));
  const un = await apply("numbered-list", "1. a\n2. b", 0, 9);
  ok("numbered toggle again removes", un && un.insert === "a\nb", JSON.stringify(un));
}
// LISTS — checklist
{
  const c = await apply("checklist", "foo", 0, 3);
  ok("checklist 'foo' → '- [ ] foo'", c && c.insert === "- [ ] foo", JSON.stringify(c));
  const uc = await apply("checklist", "- [ ] foo", 0, 9);
  ok("checklist '- [ ] foo' → 'foo'", uc && uc.insert === "foo", JSON.stringify(uc));
  const swap = await apply("checklist", "- foo", 0, 5);
  ok("bullet→checklist '- foo' → '- [ ] foo' (no '- - [ ]')",
    swap && swap.insert === "- [ ] foo", JSON.stringify(swap));
}

// CODE-BLOCK
{
  const cb = await apply("code-block", "foo", 0, 3);
  ok("code-block 'foo' → fenced w/ selFrom after '```\\n'",
    cb && cb.insert === "```\nfoo\n```" && cb.selFrom === 4, JSON.stringify(cb));
  const ucb = await apply("code-block", "```\nfoo\n```", 0, 11);
  ok("code-block fenced → unwrap to 'foo'", ucb && ucb.insert === "foo", JSON.stringify(ucb));
}

// CALLOUT
{
  const co = await apply("callout", "foo", 0, 3);
  ok("callout 'foo' → '> [!note]\\n> foo'", co && co.insert === "> [!note]\n> foo", JSON.stringify(co));
  const uco = await apply("callout", "> [!note]\n> foo", 0, 15);
  ok("callout block → unwrap to 'foo'", uco && uco.insert === "foo", JSON.stringify(uco));
}

// ── B. live integration in a real CM editor ──────────────────────────────────
console.log("B. live integration (real CM editor)");

await create("r33/scratch.md", "Hello world\n");
await app(async () => {
  window.__app.workspace.openFile("r33/scratch.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");

const setSel = (anchor, head) => app(([a, h]) => {
  const view = window.__app.documents.getActiveView?.()?.view;
  if (view) view.dispatch({ selection: { anchor: a, head: h } });
}, [anchor, head]);
const docText = () => app(() => window.__app.documents.get("r33/scratch.md")?.getText() ?? "");

// commands exist & are available while an editable editor is active
{
  const reg = await app(() => {
    const cmds = window.__app.commands;
    const list = (cmds.list?.() ?? cmds.getAll?.() ?? cmds.all?.() ?? []);
    const ids = Array.isArray(list)
      ? list.map((c) => (typeof c === "string" ? c : c.id))
      : Object.keys(list);
    const has = (id) => ids.includes(id);
    const avail = (id) => {
      const c = cmds.get?.(id) ?? (Array.isArray(list) ? list.find((x) => x.id === id) : list[id]);
      if (!c) return false;
      return typeof c.available === "function" ? c.available() : true;
    };
    return {
      hasBold: has("editor:toggle-bold"),
      hasItalic: has("editor:toggle-italic"),
      hasLink: has("editor:insert-link"),
      availBold: avail("editor:toggle-bold"),
    };
  });
  ok("editor:toggle-bold command registered", reg.hasBold, JSON.stringify(reg));
  ok("editor:toggle-italic command registered", reg.hasItalic, JSON.stringify(reg));
  ok("editor:insert-link command registered", reg.hasLink, JSON.stringify(reg));
  ok("editor:toggle-bold available with active editor", reg.availBold, JSON.stringify(reg));
}

// Meta+B wraps "Hello" → "**Hello**", then round-trips back
await setSel(0, 5);
await page.keyboard.press("Meta+B");
await wait(150);
const afterBold = await docText();
ok("Meta+B wraps selection → '**Hello**...'", afterBold.startsWith("**Hello**"), JSON.stringify(afterBold));
// selection is now the inner "Hello" (selFrom=2,selTo=7) → toggling unwraps it
await page.keyboard.press("Meta+B");
await wait(150);
const afterUnbold = await docText();
ok("Meta+B again round-trips back to 'Hello world'", afterUnbold.startsWith("Hello world"), JSON.stringify(afterUnbold));

// Meta+I wraps with single asterisks
await setSel(0, 5);
await page.keyboard.press("Meta+I");
await wait(150);
const afterItalic = await docText();
ok("Meta+I wraps selection → '*Hello*...'",
  afterItalic.startsWith("*Hello*") && !afterItalic.startsWith("**Hello"), JSON.stringify(afterItalic));
// undo the italic so the next case starts clean
await setSel(0, 7);
await page.keyboard.press("Meta+I");
await wait(150);

// Meta+K on a selection produces a "[...]()" link
await setSel(0, 5);
await page.keyboard.press("Meta+K");
await wait(150);
const afterLink = await docText();
ok("Meta+K builds a link '[label]()...'",
  afterLink.startsWith("[") && afterLink.includes("]()"), JSON.stringify(afterLink));

console.log(`\nR33 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exitCode = 1; }
await browser.close();
process.exit(failed ? 1 : 0);
