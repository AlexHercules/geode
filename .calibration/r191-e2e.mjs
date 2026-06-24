/**
 * R191 — G3 missing→done: editor:add-cursor-above / editor:add-cursor-below
 * (Obsidian multi-cursor) — browser :1420.
 * Run: node .calibration/r191-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 191 additions".
 *
 * Drives the live CM view: add-cursor-below adds a collapsed cursor one line down at the
 * same column (cascading), add-cursor-above one line up; no-op at the doc edge. The doc
 * bytes never change (selection-only — no .md write).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r191", name: "r191", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (id) => app(([cid]) => window.__app.commands.execute(cid), [id]);

const IDS = ["editor:add-cursor-above", "editor:add-cursor-below"];
console.log("— both commands registered + names resolve + no default hotkey —");
const reg = await app(([ids]) => ids.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null, hk: window.__app.commands.getEffectiveHotkey(id) || null };
}), [IDS]);
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("cmd."), r.name);
  ok(`${r.id} has no default hotkey`, r.hk === null, r.hk);
}

console.log("— live CM view: add-cursor cascades down, same column, doc unchanged —");
const CONTENT = "aaaa\nbbbb\ncccc\ndddd\n"; // lines 1..4 at offsets 0/5/10/15
await app(async (c) => { try { await window.__app.vault.create("r191mc.md", c); } catch { /* exists */ } }, CONTENT);
await app(() => {
  window.__app.workspace.openFile("r191mc.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);

const heads = () => app(() => window.__app.documents.getActiveView().view.state.selection.ranges.map((r) => r.head).sort((a, b) => a - b));
const docStr = () => app(() => window.__app.documents.getActiveView().view.state.doc.toString());
const setCursor = (pos) => app(([p]) => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: p } }), [pos]);

const before = await docStr();
await setCursor(7); // line 2 (bbbb), column 2
await wait(40);
ok("starts with a single cursor", (await heads()).length === 1);

await exec("editor:add-cursor-below");
await wait(80);
let h = await heads();
ok("add-cursor-below → 2 cursors at line2+line3 same col (7,12)", h.length === 2 && h[0] === 7 && h[1] === 12, JSON.stringify(h));

await exec("editor:add-cursor-below");
await wait(80);
h = await heads();
ok("again → 3 cursors cascading to line4 (7,12,17)", h.length === 3 && h[2] === 17, JSON.stringify(h));

ok("doc bytes unchanged after adding cursors (selection-only)", (await docStr()) === before, await docStr());

console.log("— add-cursor-above cascades up; edge is a no-op —");
await setCursor(12); // collapse to single cursor on line 3 col 2
await wait(40);
ok("reset to single cursor", (await heads()).length === 1);
await exec("editor:add-cursor-above");
await wait(80);
h = await heads();
ok("add-cursor-above → 2 cursors (line3 + line2: 7,12)", h.length === 2 && h[0] === 7 && h[1] === 12, JSON.stringify(h));

// move to line 1 and try to go above → edge no-op
await setCursor(2); // line 1 col 2
await wait(40);
await exec("editor:add-cursor-above");
await wait(80);
ok("add-cursor-above at top line → no-op (still 1 cursor)", (await heads()).length === 1, JSON.stringify(await heads()));

console.log("— dedup: a cursor already at the target is not duplicated —");
await setCursor(7);
await wait(40);
await exec("editor:add-cursor-below"); // adds at 12 (now main)
await wait(60);
// move main back up to 7's neighbourhood won't easily dedup; instead re-run below from line3 main
// simpler: from [7,12] main=12, add-cursor-above targets line2 col2 = 7 which already exists → no-op
await exec("editor:add-cursor-above");
await wait(80);
ok("add-cursor-above onto an existing cursor pos → no duplicate (still 2)", (await heads()).length === 2, JSON.stringify(await heads()));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR191: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
