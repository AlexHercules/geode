/**
 * R205 — G3 missing→done: editor:insert-table (插入表格). Extends the R33 pure
 * format engine (core/format.ts) with one INSERT-only op that drops an empty 2×2
 * GFM table skeleton (header + body row, 2 columns) at the cursor, placing the
 * caret in the first header cell. Mirrors R198 horizontal-rule: does NOT consume
 * the selection (collapses to `to`). Browser :1420.  Run: node .calibration/r205-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 205 additions".
 *
 * A = byte-level __geodeFormat.apply probe (exact FormatEdit) for each context.
 * D = render PROOF via __geodeRenderMarkdown: the skeleton renders as a real
 *     <table> with 2 columns (the fidelity check — it IS a valid GFM table).
 * B = command registration + no default hotkey (Obsidian "未设置").
 * C = live CM view: real command inserts the table, prior text intact, caret in
 *     the first header cell.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r205", name: "r205", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFormat && !!window.__app && !!window.__geodeRenderMarkdown, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const apply = (op, text, from, to) =>
  app(([o, t, f, u]) => window.__geodeFormat.apply(o, t, f, u), [op, text, from, to]);
const render = (src) => app((s) => window.__geodeRenderMarkdown(s), src);

// The frozen skeleton (aligned cells padded to the `---` separator width).
const SKEL = "|     |     |\n| --- | --- |\n|     |     |\n";

console.log("A. insert-table byte-level (empty 2×2 skeleton, pure insert, no consume)");
let e = await apply("table", "", 0, 0);
ok("empty doc → skeleton, no lead, span [0,0]", e?.insert === SKEL && e.from === 0 && e.to === 0, JSON.stringify(e));
ok("empty doc → caret in first header cell (selFrom=selTo=2)", e?.selFrom === 2 && e.selTo === 2, JSON.stringify(e));

e = await apply("table", "Hello", 5, 5);
ok("end of text line → lead '\\n' added, span [5,5]", e?.insert === "\n" + SKEL && e.from === 5 && e.to === 5, JSON.stringify(e));
ok("end of text line → caret = to + lead + 2 = 8", e?.selFrom === 8 && e.selTo === 8, JSON.stringify(e));

e = await apply("table", "a\n", 2, 2);
ok("on empty line (after \\n) → no lead, caret = 4", e?.insert === SKEL && e.from === 2 && e.selFrom === 4, JSON.stringify(e));

e = await apply("table", "ab", 1, 1);
ok("mid-line → lead '\\n' before + trailing '\\n' fence after (text 'b' follows)", e?.insert === "\n" + SKEL + "\n" && e.from === 1 && e.to === 1, JSON.stringify(e));

e = await apply("table", "keep this", 0, 9);
ok("底线①: selection NOT consumed (span collapses to end [9,9], text kept)", e?.from === 9 && e.to === 9, JSON.stringify(e));
ok("底线①: insert prepends '\\n' before the kept text's line, never replaces it (nothing follows → no trail)", e?.insert === "\n" + SKEL, JSON.stringify(e));

console.log("A3. trailing-fence (a GFM table is NOT self-terminating — fence off following text)");
e = await apply("table", "below", 0, 0);
ok("table ABOVE text (caret at start) → trailing '\\n' fence added (no lead)", e?.insert === SKEL + "\n" && e.from === 0 && e.to === 0, JSON.stringify(e));
ok("table ABOVE text → caret still in first cell (selFrom=2, unaffected by trail)", e?.selFrom === 2 && e.selTo === 2, JSON.stringify(e));
e = await apply("table", "x\nbelow", 2, 2);
ok("caret on its own line, text below (after '\\n') → no lead, trailing fence added", e?.insert === SKEL + "\n" && e.from === 2, JSON.stringify(e));
e = await apply("table", "x\n\nbelow", 2, 2);
ok("already a blank line below (text[to]=='\\n') → NO trailing fence (no double blank)", e?.insert === SKEL && e.from === 2, JSON.stringify(e));
e = await apply("table", "end", 3, 3);
ok("end of doc → NO trailing fence (nothing follows)", e?.insert === "\n" + SKEL && e.from === 3, JSON.stringify(e));

console.log("A2. skeleton shape (2 columns, header + delimiter + body, valid GFM)");
const lines = SKEL.split("\n").filter((l) => l.length > 0);
ok("3 non-empty lines: header, delimiter, body", lines.length === 3, JSON.stringify(lines));
ok("delimiter row is a GFM 2-column separator", /^\|\s*-{3,}\s*\|\s*-{3,}\s*\|$/.test(lines[1]), lines[1]);
ok("each row has exactly 2 columns (3 pipes)", lines.every((l) => (l.match(/\|/g) || []).length === 3), JSON.stringify(lines));
ok("header + body cells are empty (whitespace only)", /^\|\s*\|\s*\|$/.test(lines[0]) && /^\|\s*\|\s*\|$/.test(lines[2]), JSON.stringify(lines));

console.log("D. render PROOF (__geodeRenderMarkdown): skeleton IS a real table");
const tableHtml = await render(SKEL);
ok("skeleton renders an HTML <table>", /<table\b/.test(tableHtml), tableHtml);
ok("table has a 2-column header row (2 <th>)", (tableHtml.match(/<th\b/g) || []).length === 2, tableHtml);
ok("table has a body row (<td>)", /<td\b/.test(tableHtml), tableHtml);

console.log("D2. render PROOF: trailing fence stops the table absorbing the paragraph below");
// Simulate the ACTUAL insertTable output for 'insert table above existing text'
// (the context the review caught): a GFM table is greedy, so without the trail
// 'below' would become a 4th <td>. Feed the real produced bytes back through render.
const above = await apply("table", "below", 0, 0); // → SKEL + "\n" + (then) "below"
const aboveDoc = above.insert + "below";
const aboveHtml = await render(aboveDoc);
ok("table above text → 'below' stays a SEPARATE paragraph (<p>below</p>)", /<p>below<\/p>/.test(aboveHtml), aboveHtml);
ok("table above text → exactly 2 <td> (paragraph NOT absorbed as a 4th cell)", (aboveHtml.match(/<td\b/g) || []).length === 2, aboveHtml);
// CONTRAST: the unfenced (buggy) form WOULD absorb it — proves the fence is load-bearing
const unfencedHtml = await render(SKEL + "below");
ok("CONTRAST: unfenced 'SKEL+below' absorbs the line (>2 <td> or no separate <p>) — the trap the fence avoids", (unfencedHtml.match(/<td\b/g) || []).length > 2 || !/<p>below<\/p>/.test(unfencedHtml), unfencedHtml);

console.log("B. command registration + no default hotkey (Obsidian '未设置')");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:insert-table");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("editor:insert-table") || null };
});
ok("editor:insert-table registered", reg.present);
ok("name resolves (not raw 'cmd.' key)", !!reg.name && !reg.name.startsWith("cmd."), String(reg.name));
ok("name is 'Insert table' (EN)", reg.name === "Insert table", String(reg.name));
ok("has NO default hotkey", reg.hotkey === null, String(reg.hotkey));

console.log("C. live CM view: real command inserts table, prior text intact, caret in first cell");
await app(async () => { try { await window.__app.vault.create("r205.md", "alpha beta\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r205.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);
// cursor just after "alpha beta" (offset 10, before the trailing \n)
await app(() => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: 10, head: 10 } }));
await wait(60);
await app(() => window.__app.commands.execute("editor:insert-table"));
await wait(100);
const after = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live: 'alpha beta' kept verbatim at the start", after.startsWith("alpha beta"), JSON.stringify(after));
ok("live: table skeleton inserted (delimiter row present)", after.includes("| --- | --- |"), JSON.stringify(after));
ok("live: table sits on its own lines (lead \\n inserted)", after.includes("beta\n|     |     |"), JSON.stringify(after));
const head = await app(() => window.__app.documents.getActiveView().view.state.selection.main.head);
ok("live: caret in first header cell (head = 10 + lead + 2 = 13)", head === 13, String(head));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR205: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
