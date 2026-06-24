/**
 * R207 — G3 §17 table editor 片 B: editor:table-copy-row/-copy-column /
 * -move-row-up/-move-row-down / -move-column-left/-move-column-right /
 * -align-left/-align-right/-align-center. 9 pure model ops added to R206's vetted
 * core/tableEditor.ts (parse/serialize/detect/guard layer UNCHANGED). Browser :1420.
 * Run: node .calibration/r207-e2e.mjs   Contract: ARCHITECTURE "Round 207 additions".
 *
 * A  = byte-level __geodeTableEdit(op, tableText, offset) for each op + no-op guards.
 * D  = render PROOF: alignment markers (:-- / --: / :-:) produce text-align in HTML.
 * G  = R206 overlay-pipe guard still gates the new ops (uniform safety).
 * B  = registration (9 commands, no default hotkey).
 * C  = live CM: editor:table-move-row-down rearranges a real table (shared runTableOp).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r207", name: "r207", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeTableEdit && !!window.__app && !!window.__geodeRenderMarkdown, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const te = (op, text, offset) => app(([o, t, off]) => window.__geodeTableEdit(o, t, off), [op, text, offset]);
const render = (src) => app((s) => window.__geodeRenderMarkdown(s), src);

const T = "| a | b |\n| --- | --- |\n| 1 | 2 |";              // 'a'2 'b'6 ; row2@24 '1'26 '2'30
const T3 = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";  // '3'36 '4'40

console.log("A. duplicate (复制=duplicate)");
let e = await te("copy-row", T3, 26);
ok("copy-row (body0) → row [1,2] duplicated below",
  e?.text === "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 1 | 2 |\n| 3 | 4 |", JSON.stringify(e));
ok("copy-row on header → null", (await te("copy-row", T3, 2)) === null);
e = await te("copy-column", T, 26);
ok("copy-column (col0) → column a duplicated right",
  e?.text === "| a | a | b |\n| --- | --- | --- |\n| 1 | 1 | 2 |", JSON.stringify(e));

console.log("A2. move row / column (swap)");
e = await te("move-row-up", T3, 36);
ok("move-row-up (body1) → rows swapped",
  e?.text === "| a | b |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |", JSON.stringify(e));
ok("move-row-up on body0 → null (can't move above header)", (await te("move-row-up", T3, 26)) === null);
e = await te("move-row-down", T3, 26);
ok("move-row-down (body0) → rows swapped",
  e?.text === "| a | b |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |", JSON.stringify(e));
ok("move-row-down on last body row → null", (await te("move-row-down", T3, 36)) === null);
e = await te("move-column-left", T, 30);
ok("move-column-left (col1) → columns swapped (header+aligns+rows)",
  e?.text === "| b | a |\n| --- | --- |\n| 2 | 1 |", JSON.stringify(e));
ok("move-column-left on col0 → null", (await te("move-column-left", T, 26)) === null);
e = await te("move-column-right", T, 26);
ok("move-column-right (col0) → columns swapped",
  e?.text === "| b | a |\n| --- | --- |\n| 2 | 1 |", JSON.stringify(e));
ok("move-column-right on last col → null", (await te("move-column-right", T, 30)) === null);

console.log("A3. column alignment (set, not toggle)");
e = await te("align-left", T, 26);
ok("align-left (col0) → delimiter ':--'", e?.text === "| a | b |\n| :-- | --- |\n| 1 | 2 |", JSON.stringify(e));
e = await te("align-right", T, 30);
ok("align-right (col1) → delimiter '--:'", e?.text === "| a | b |\n| --- | --: |\n| 1 | 2 |", JSON.stringify(e));
e = await te("align-center", T, 26);
ok("align-center (col0) → delimiter ':-:'", e?.text === "| a | b |\n| :-: | --- |\n| 1 | 2 |", JSON.stringify(e));

console.log("D. render PROOF: alignment markers → text-align in HTML");
const hl = await render((await te("align-left", T, 26)).text);
ok("':--' renders text-align:left on column 0", /<t[hd][^>]*text-align:\s*left/.test(hl), hl.replace(/\n/g, " ").slice(0, 200));
const hc = await render((await te("align-center", T, 26)).text);
ok("':-:' renders text-align:center", /text-align:\s*center/.test(hc), hc.replace(/\n/g, " ").slice(0, 160));
const hr = await render((await te("align-right", T, 30)).text);
ok("'--:' renders text-align:right", /text-align:\s*right/.test(hr), hr.replace(/\n/g, " ").slice(0, 160));

console.log("G. R206 overlay-pipe guard still gates the片B ops (uniform safety)");
const OV = "| Link | Note |\n| --- | --- |\n| [[Page|Alias]] | hello |";
ok("move-column-left on [[a|b]] table → null (guard uniform)", (await te("move-column-left", OV, 35)) === null);
ok("align-center on [[a|b]] table → null", (await te("align-center", OV, 35)) === null);
ok("copy-row on [[a|b]] table → null", (await te("copy-row", OV, 35)) === null);

console.log("B. command registration + no default hotkey (9 新命令)");
const reg = await app(() => {
  const ids = [
    "editor:table-copy-row", "editor:table-copy-column", "editor:table-move-row-up", "editor:table-move-row-down",
    "editor:table-move-column-left", "editor:table-move-column-right",
    "editor:table-align-left", "editor:table-align-right", "editor:table-align-center",
  ];
  return ids.map((id) => {
    const c = window.__app.commands.list().find((x) => x.id === id);
    return { id, present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey(id) || null };
  });
});
for (const r of reg) {
  ok(`${r.id} registered, name resolves, no hotkey`,
    r.present && !!r.name && !r.name.startsWith("cmd.") && r.hotkey === null, JSON.stringify(r));
}

console.log("C. live CM: editor:table-move-row-down rearranges a real table");
await app(async () => { try { await window.__app.vault.create("r207.md", "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r207.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(200);
await app(() => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: 26, head: 26 } })); // body0 '1'
await wait(60);
await app(() => window.__app.commands.execute("editor:table-move-row-down"));
await wait(100);
const after = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live: body rows swapped ([3,4] now precedes [1,2])", /\| 3 \| 4 \|\n\| 1 \| 2 \|/.test(after), JSON.stringify(after));
ok("live: header/delimiter intact", after.startsWith("| a | b |\n| --- | --- |"), JSON.stringify(after));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR207: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
