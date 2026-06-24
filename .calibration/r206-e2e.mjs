/**
 * R206 — G3 §17 table editor 片 A: editor:table-insert-row-above/below /
 * insert-column-left/right / delete-row / delete-column. New pure model
 * core/tableEditor.ts (applyTableOp) — parse a GFM pipe table, apply a structural
 * op, re-serialize. Cell split mirrors markdown-it escapedSplit (reading-view
 * aligned). Browser :1420.  Run: node .calibration/r206-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 206 additions".
 *
 * A  = byte-level __geodeTableEdit(op, tableText, offset) → {text, cursorOffsetInTable}.
 * A2 = escape round-trip (a cell with a literal pipe `a\|b` must re-escape, not corrupt).
 * D  = render PROOF: a serialized table renders as a real <table>; the escaped cell
 *      keeps its literal pipe (2 columns, not a corrupted 3-column header).
 * B  = command registration (6 commands, no default hotkey).
 * C  = live CM view: editor:table-insert-row-below adds a row in a real editor.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r206", name: "r206", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeTableEdit && !!window.__app && !!window.__geodeRenderMarkdown, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const te = (op, text, offset) =>
  app(([o, t, off]) => window.__geodeTableEdit(o, t, off), [op, text, offset]);
const render = (src) => app((s) => window.__geodeRenderMarkdown(s), src);

// base table: header [a,b] + body row [1,2]. offsets: 'a'=2 'b'=6 ; line1@10 ; line2@24 '1'=26 '2'=30
const T = "| a | b |\n| --- | --- |\n| 1 | 2 |";

console.log("A. byte-level __geodeTableEdit (parse → op → serialize)");
let e = await te("insert-row-below", T, 26);
ok("insert-row-below (body0,col0) → empty row appended",
  e?.text === "| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |", JSON.stringify(e));
ok("insert-row-below → caret in the new row's first cell (36)", e?.cursorOffsetInTable === 36, JSON.stringify(e));

e = await te("insert-row-above", T, 2);
ok("insert-row-above from header → empty row above the body",
  e?.text === "| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |", JSON.stringify(e));

e = await te("insert-column-left", T, 26);
ok("insert-column-left (col0) → empty column inserted left",
  e?.text === "|  | a | b |\n| --- | --- | --- |\n|  | 1 | 2 |", JSON.stringify(e));

e = await te("insert-column-right", T, 26);
ok("insert-column-right (col0) → empty column inserted right",
  e?.text === "| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |", JSON.stringify(e));

e = await te("delete-column", T, 30);
ok("delete-column (col1) → column b removed",
  e?.text === "| a |\n| --- |\n| 1 |", JSON.stringify(e));

e = await te("delete-row", T, 26);
ok("delete-row (body0) → header + delimiter remain (valid empty table)",
  e?.text === "| a | b |\n| --- | --- |", JSON.stringify(e));
ok("delete-row → caret back in header first cell (2)", e?.cursorOffsetInTable === 2, JSON.stringify(e));

console.log("A1. no-op guards (return null)");
ok("delete-row on the header line → null (can't delete header)", (await te("delete-row", T, 2)) === null);
ok("delete-column on a 1-column table → null (never leave 0 columns)",
  (await te("delete-column", "| a |\n| --- |\n| 1 |", 2)) === null);
ok("cursor not in a valid table → null", (await te("delete-row", "just a paragraph", 0)) === null);

console.log("A1b. overlay-pipe guard (底线①: a pipe inside a wikilink/code/math cell → refuse, never split it)");
// The plausible corruption: a normal table whose BODY cell holds [[Page|Alias]].
const BW = "| Link | Note |\n| --- | --- |\n| [[Page|Alias]] | hello |";
ok("body cell [[Page|Alias]] → null (would otherwise tear the wikilink across a column)", (await te("insert-row-below", BW, 35)) === null);
ok("header cell [[a|b]] → null", (await te("insert-column-right", "| [[a|b]] | c |\n| --- | --- |\n| 1 | 2 |", 4)) === null);
ok("inline-code pipe `a|b` → null", (await te("delete-row", "| `a|b` | c |\n| --- | --- |\n| 1 | 2 |", 30)) === null);
ok("inline-math pipe $a|b$ → null", (await te("delete-row", "| $a|b$ | c |\n| --- | --- |\n| 1 | 2 |", 30)) === null);
ok("inline-math with escaped dollar $a\\$|b$ → null (escape-aware guard, no tear)", (await te("insert-row-below", "| x | y |\n| --- | --- |\n| $a\\$|b$ | c |", 30)) === null);
// but a wikilink WITHOUT a pipe is safe and editable — and must be preserved verbatim
const WP = await te("insert-row-below", "| [[Page]] | c |\n| --- | --- |\n| 1 | 2 |", 33);
ok("pipe-less [[Page]] table IS editable and preserves the wikilink", WP?.text.includes("| [[Page]] | c |") && WP.text.includes("\n|  |  |"), JSON.stringify(WP));
// currency tables have NO overlay → must remain editable (no false-positive decline)
const CUR = await te("insert-row-below", "| $5 | $10 |\n| --- | --- |\n| a | b |", 29);
ok("currency table | $5 | $10 | is editable (no false overlay-pipe decline)", CUR !== null && CUR.text.includes("| $5 | $10 |"), JSON.stringify(CUR));
// blockquote-nested table: the range slice carries '> ' on the delim/body rows → the
// delimiter parses a '>' cell that fails parseAlign → null (safe decline, v1 limitation).
const BQ = await te("insert-row-below", "| a | b |\n> | --- | --- |\n> | 1 | 2 |", 30);
ok("blockquote-nested table → null (safe decline, not corrupted)", BQ === null, JSON.stringify(BQ));

console.log("A2. escape round-trip (a literal pipe in a cell must NOT corrupt)");
// source cell "a\|b" → model stores literal "a|b" → must re-serialize as "a\|b"
const TE = "| a\\|b | c |\n| --- | --- |\n| 1 | 2 |"; // '1' is at offset 29
e = await te("insert-row-below", TE, 29);
ok("in-cell pipe re-escaped in output (contains 'a\\|b')", e?.text.includes("a\\|b"), JSON.stringify(e));
ok("table stays 2-column (header still '| a\\|b | c |')", e?.text.startsWith("| a\\|b | c |"), JSON.stringify(e));

console.log("A3. ragged table → no body cell dropped (底线①)");
// body row has 3 cells but header only 2: an edit must KEEP the 3rd, padding the header.
const RAGGED = "| a | b |\n| --- | --- |\n| 1 | 2 | 3 |"; // '1' at offset 26
const rg = await te("insert-row-below", RAGGED, 26);
ok("ragged: the extra body cell '3' is preserved (not dropped)", rg?.text.includes("| 1 | 2 | 3 |"), JSON.stringify(rg));
ok("ragged: header padded to the widest row (3 columns)",
  rg?.text.startsWith("| a | b |  |\n| --- | --- | --- |"), JSON.stringify(rg));

console.log("D. render PROOF (__geodeRenderMarkdown)");
const htmlPlain = await render((await te("insert-column-right", T, 26)).text);
ok("serialized table renders as a <table>", /<table\b/.test(htmlPlain), htmlPlain);
ok("3-column table renders 3 <th>", (htmlPlain.match(/<th\b/g) || []).length === 3, htmlPlain);
const htmlEsc = await render(e.text);
ok("escaped cell renders a real table (not corrupted into 3 columns)",
  /<table\b/.test(htmlEsc) && (htmlEsc.match(/<th\b/g) || []).length === 2, htmlEsc);
ok("escaped cell's literal pipe survives render (<th> contains 'a|b')", /<th[^>]*>a\|b<\/th>/.test(htmlEsc), htmlEsc);

console.log("B. command registration + no default hotkey");
const reg = await app(() => {
  const ids = [
    "editor:table-insert-row-above", "editor:table-insert-row-below",
    "editor:table-insert-column-left", "editor:table-insert-column-right",
    "editor:table-delete-row", "editor:table-delete-column",
  ];
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

console.log("C. live CM view: editor:table-insert-row-below adds a row");
await app(async () => { try { await window.__app.vault.create("r206.md", "| a | b |\n| --- | --- |\n| 1 | 2 |\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r206.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(200);
// cursor into the body cell "1" (offset 26 in the doc)
await app(() => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: 26, head: 26 } }));
await wait(60);
await app(() => window.__app.commands.execute("editor:table-insert-row-below"));
await wait(100);
const after = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live: a new empty row '|  |  |' is inserted after the body row",
  after.includes("| 1 | 2 |\n|  |  |"), JSON.stringify(after));
ok("live: header/body content kept verbatim", after.startsWith("| a | b |\n| --- | --- |\n| 1 | 2 |"), JSON.stringify(after));

console.log("C2. live: indented / list-nested table keeps its indent on EVERY row (底线①)");
await app(async () => { try { await window.__app.vault.create("r206-indent.md", "- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r206-indent.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(200);
// cursor into the indented body cell "1" (offset 40 in the doc)
await app(() => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: 40, head: 40 } }));
await wait(60);
const tablesBefore = await app(() => window.__geodeTable.ranges(window.__app.documents.getActiveView().view.state.doc.toString()).length);
await app(() => window.__app.commands.execute("editor:table-insert-row-below"));
await wait(100);
const afterI = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
const tablesAfter = await app((doc) => window.__geodeTable.ranges(doc).length, afterI);
ok("indented: delimiter row keeps its 2-space indent", afterI.includes("\n  | --- | --- |"), JSON.stringify(afterI));
ok("indented: new row is inserted WITH the indent ('  |  |  |')", afterI.includes("  | 1 | 2 |\n  |  |  |"), JSON.stringify(afterI));
ok("indented: NO row was flushed left (table not collapsed)", !/\n\| --- \| --- \|/.test(afterI), JSON.stringify(afterI));
ok("indented: still exactly 1 table after the edit (was " + tablesBefore + ")", tablesAfter === 1, `before=${tablesBefore} after=${tablesAfter}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR206: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
