/**
 * R204 — G3 §2: editor:rename-heading (片 A — rename heading text + same-file self-anchor links).
 * Pure logic = core/renameHeading.ts. Browser :1420.   Run: node .calibration/r204-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 204 additions".
 *
 * A = byte-level renameHeadingAt via __geodeRenameHeading (heading + self-anchor; case/markdown/alias/
 *     embed match; link-unsafe guard; cross-file untouched; no-op cases). B = registration. C = live CM.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r204", name: "r204", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeRenameHeading, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// rename at the cursor placed inside the heading text; returns the changes array (or null)
const rn = (text, cursor, next) => app(([t, c, n]) => window.__geodeRenameHeading(t, c, n), [text, cursor, next]);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("A. byte-level renameHeadingAt");
let r = await rn("## Old\nbody\n", 4, "New");
ok("plain heading: '## Old' → text change [3,6)='New' (no self-refs)", eq(r, [{ from: 3, to: 6, insert: "New" }]), JSON.stringify(r));

r = await rn("## Old\n[[#Old]] x\nbody\n", 4, "New");
ok("self-anchor '[[#Old]]' updated: heading [3,6) + subpath [10,13) → 'New'", eq(r, [{ from: 3, to: 6, insert: "New" }, { from: 10, to: 13, insert: "New" }]), JSON.stringify(r));

r = await rn("## Old\n[[#old]]\n", 4, "New"); // case-insensitive match
ok("case-insensitive self-anchor match ('[[#old]]' → 'New')", r && r.length === 2 && r[1].insert === "New", JSON.stringify(r));

r = await rn("## Old\n[[#Old|alias]]\n", 4, "New"); // alias preserved (only subpath replaced)
ok("alias preserved: only '[[#Old' subpath replaced, '|alias]]' kept", r && r.length === 2 && r[1].from === 10 && r[1].to === 13 && r[1].insert === "New", JSON.stringify(r));

r = await rn("## Old\n![[#Old]]\n", 4, "New"); // embed: '!' prefix offsets subFrom
ok("embed '![[#Old]]': subpath after '![[#' replaced", r && r.length === 2 && r[1].from === 11 && r[1].insert === "New", JSON.stringify(r));

r = await rn("## **Bold**\n[[#bold]]\n", 5, "Plain"); // markdown heading: strip matches '[[#bold]]'
ok("markdown heading '**Bold**': self-anchor '[[#bold]]' matched via strip → 'Plain'", r && r.length === 2 && r[0].insert === "Plain" && r[1].insert === "Plain", JSON.stringify(r));

r = await rn("## Old\n[[#Old]]\n", 4, "New | Bad"); // link-unsafe new text → skip self-anchor
ok("link-unsafe new text ('New | Bad') → heading renamed, self-anchor NOT touched", r && r.length === 1 && r[0].insert === "New | Bad", JSON.stringify(r));

r = await rn("## Old\n[[Other#Old]]\n", 4, "New"); // cross-FILE ref must NOT be touched (片 A boundary)
ok("片 A boundary: cross-file '[[Other#Old]]' untouched (only heading renamed)", eq(r, [{ from: 3, to: 6, insert: "New" }]), JSON.stringify(r));

r = await rn("## Old\n[[#Different]]\n", 4, "New"); // non-matching self-anchor stays
ok("non-matching self-anchor '[[#Different]]' untouched", eq(r, [{ from: 3, to: 6, insert: "New" }]), JSON.stringify(r));

// code-context: scan runs on maskCodeRegions, so code-literal self-anchors / fenced headings are excluded
r = await rn("## Old\n`see [[#Old]] here`\n", 4, "New");
ok("code-context: '[[#Old]]' inside inline code NOT rewritten (only heading)", eq(r, [{ from: 3, to: 6, insert: "New" }]), JSON.stringify(r));
r = await rn("## Old\n```\n[[#Old]]\n```\n", 4, "New");
ok("code-context: '[[#Old]]' inside a fence NOT rewritten", eq(r, [{ from: 3, to: 6, insert: "New" }]), JSON.stringify(r));
r = await rn("text\n```\n## Old\n```\nmore\n", 13, "New"); // cursor on a fenced '## Old'
ok("code-context: fenced '## Old' is NOT a heading (no-op)", r === null, JSON.stringify(r));
// block ref [[#^abc]] is skipped (the '^' guard) even when the heading is literally named '^abc'
r = await rn("## ^abc\n[[#^abc]]\n", 4, "New");
ok("block ref '[[#^abc]]' skipped (only heading renamed)", eq(r, [{ from: 3, to: 7, insert: "New" }]), JSON.stringify(r));
// a newline in the new text is collapsed (a heading + subpath are single-line)
r = await rn("## Old\n[[#Old]]\n", 4, "New\nLine");
ok("newline in new text collapsed → 'New Line' (no line split / broken link)", r && r.length === 2 && r[0].insert === "New Line" && r[1].insert === "New Line", JSON.stringify(r));

ok("not on a heading line → null", (await rn("plain text line\n", 4, "New")) === null);
ok("empty new text → null (no-op)", (await rn("## Old\n", 4, "  ")) === null);
ok("unchanged new text → null (no-op)", (await rn("## Old\n", 4, "Old")) === null);

console.log("B. command registration + no default hotkey");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:rename-heading");
  return { present: !!c, name: c ? c.name() : null, key: window.__app.commands.getEffectiveHotkey("editor:rename-heading") || null };
});
ok("editor:rename-heading registered + name resolves", reg.present && !!reg.name && !reg.name.startsWith("cmd."), JSON.stringify(reg));
ok("no default hotkey (Obsidian unset)", reg.key === null, reg.key);

console.log("C. live CM: prompt → rename heading + self-anchor in one undoable transaction");
await app(async () => { try { await window.__app.vault.create("r204.md", "## Old Heading\n[[#Old Heading]] see\nbody\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r204.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);
// cursor inside the heading text
await app(() => { const v = window.__app.documents.getActiveView().view; v.dispatch({ selection: { anchor: 6 } }); });
await wait(60);
// mock the prompt to return the new heading text
await app(() => { window.prompt = () => "New Heading"; });
await app(() => window.__app.commands.execute("editor:rename-heading"));
await wait(120);
let doc = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live: heading + self-anchor renamed → '## New Heading\\n[[#New Heading]] see'", doc === "## New Heading\n[[#New Heading]] see\nbody\n", JSON.stringify(doc));
// undoable in one step
await app(() => window.__app.documents.getActiveView().view.focus());
await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
await wait(120);
doc = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("rename is one undoable transaction (Ctrl/Cmd-Z restores both)", doc === "## Old Heading\n[[#Old Heading]] see\nbody\n", JSON.stringify(doc));
// cursor NOT on a heading → no prompt, no-op
await app(() => { const v = window.__app.documents.getActiveView().view; const d = v.state.doc.toString(); v.dispatch({ selection: { anchor: d.indexOf("body") + 1 } }); });
await wait(40);
let promptCalls = await app(() => { window.__promptCalls = 0; window.prompt = () => { window.__promptCalls++; return "X"; }; return 0; });
await app(() => window.__app.commands.execute("editor:rename-heading"));
await wait(80);
ok("cursor not on a heading → no prompt, no change", (await app(() => window.__promptCalls)) === 0 && (await app(() => window.__app.documents.getActiveView().view.state.doc.toString())) === "## Old Heading\n[[#Old Heading]] see\nbody\n");

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR204: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
